'use strict';
const { getDb } = require('../db/database');
const { authMiddleware, loadUser } = require('../middleware/auth');
const { messageLimitGuard } = require('../middleware/tier');
const { streamChat, complete } = require('../services/openrouter');

async function chatRoutes(fastify) {
  const preHandler = [authMiddleware, loadUser, messageLimitGuard()];

  // GET /api/chat/conversations
  fastify.get('/conversations', { preHandler: [authMiddleware, loadUser] }, async (request) => {
    const db = getDb();
    return db.prepare(`
      SELECT c.*, COUNT(m.id) AS message_count
      FROM conversations c
      LEFT JOIN messages m ON m.conversation_id = c.id
      WHERE c.user_id = ?
      GROUP BY c.id
      ORDER BY c.updated_at DESC
      LIMIT 50
    `).all(request.user.id);
  });

  // POST /api/chat/conversations
  fastify.post('/conversations', { preHandler: [authMiddleware, loadUser] }, async (request, reply) => {
    const db = getDb();
    const user = request.dbUser;
    const model = request.body?.model;

    const result = db.prepare(`
      INSERT INTO conversations (user_id, title, model) VALUES (?, 'New Conversation', ?)
    `).run(user.id, model || 'default');

    return reply.code(201).send({
      id: result.lastInsertRowid,
      title: 'New Conversation',
      model: model || 'default',
    });
  });

  // DELETE /api/chat/conversations/:id
  fastify.delete('/conversations/:id', { preHandler: [authMiddleware, loadUser] }, async (request, reply) => {
    const db = getDb();
    db.prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?')
      .run(request.params.id, request.user.id);
    return reply.code(204).send();
  });

  // GET /api/chat/conversations/:id/messages
  fastify.get('/conversations/:id/messages', { preHandler: [authMiddleware, loadUser] }, async (request) => {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM messages WHERE conversation_id = ? AND user_id = ?
      ORDER BY created_at ASC LIMIT 200
    `).all(request.params.id, request.user.id);
  });

  // POST /api/chat/stream — SSE streaming endpoint
  fastify.post('/stream', { preHandler }, async (request, reply) => {
    const db = getDb();
    const user = request.dbUser;
    const { conversationId, message, model } = request.body;

    if (!message || !message.trim()) {
      return reply.code(400).send({ error: 'Message is required' });
    }

    // Verify conversation belongs to user
    let conv = conversationId
      ? db.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?').get(conversationId, user.id)
      : null;

    if (!conv) {
      const r = db.prepare(`INSERT INTO conversations (user_id, title, model) VALUES (?, ?, ?)`)
        .run(user.id, message.substring(0, 50), model || 'default');
      conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(r.lastInsertRowid);
    }

    // Save user message
    db.prepare(`INSERT INTO messages (conversation_id, user_id, role, content) VALUES (?, ?, 'user', ?)`)
      .run(conv.id, user.id, message.trim());

    // Fetch last 20 messages for context
    const history = db.prepare(`
      SELECT role, content FROM messages
      WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 20
    `).all(conv.id).reverse();

    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let fullContent = '';
    try {
      const upstream = await streamChat({
        tier: user.tier,
        messages: history,
        systemPrompt: user.system_prompt || '',
        model: model !== 'default' ? model : undefined,
      });

      // Pipe OpenRouter SSE chunks to client
      for await (const chunk of upstream.body) {
        const text = chunk.toString();
        const lines = text.split('\n').filter(Boolean);

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') break;
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content || '';
              if (delta) {
                fullContent += delta;
                reply.raw.write(`data: ${JSON.stringify({ delta, convId: conv.id })}\n\n`);
              }
            } catch {}
          }
        }
      }
    } catch (err) {
      reply.raw.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    }

    // Save assistant response & increment counter
    if (fullContent) {
      db.prepare(`INSERT INTO messages (conversation_id, user_id, role, content) VALUES (?, ?, 'assistant', ?)`)
        .run(conv.id, user.id, fullContent);

      db.prepare(`UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(
          conv.title === 'New Conversation' ? message.substring(0, 60) : conv.title,
          conv.id
        );
    }

    db.prepare(`UPDATE users SET messages_today = messages_today + 1 WHERE id = ?`).run(user.id);

    reply.raw.write('data: [DONE]\n\n');
    reply.raw.end();
  });
}

module.exports = chatRoutes;
