'use strict';
const bcrypt = require('bcryptjs');
const { getDb } = require('../db/database');
const { authMiddleware, loadUser } = require('../middleware/auth');

async function authRoutes(fastify) {
  // POST /api/auth/register
  fastify.post('/register', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password', 'username'],
        properties: {
          email:    { type: 'string', format: 'email', maxLength: 255 },
          password: { type: 'string', minLength: 8, maxLength: 128 },
          username: { type: 'string', minLength: 2, maxLength: 50 },
        },
      },
    },
  }, async (request, reply) => {
    const db = getDb();
    const { email, password, username } = request.body;

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) {
      return reply.code(409).send({ error: 'Email already registered' });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = db.prepare(`
      INSERT INTO users (email, password, username, tier, last_reset_date)
      VALUES (?, ?, ?, 'free', date('now'))
    `).run(email.toLowerCase(), hash, username);

    const token = fastify.jwt.sign({ id: result.lastInsertRowid, email: email.toLowerCase() });
    const user = db.prepare('SELECT id, email, username, tier, created_at FROM users WHERE id = ?')
      .get(result.lastInsertRowid);

    return reply.code(201).send({ token, user });
  });

  // POST /api/auth/login
  fastify.post('/login', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email:    { type: 'string' },
          password: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const db = getDb();
    const { email, password } = request.body;
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const token = fastify.jwt.sign({ id: user.id, email: user.email });
    return {
      token,
      user: { id: user.id, email: user.email, username: user.username, tier: user.tier },
    };
  });

  // GET /api/auth/me
  fastify.get('/me', {
    preHandler: [authMiddleware, loadUser],
  }, async (request) => {
    const u = request.dbUser;
    return {
      id: u.id,
      email: u.email,
      username: u.username,
      tier: u.tier,
      subscription_status: u.subscription_status,
      messages_today: u.messages_today,
      images_today: u.images_today,
      system_prompt: u.system_prompt,
    };
  });

  // PATCH /api/auth/me
  fastify.patch('/me', {
    preHandler: [authMiddleware, loadUser],
    schema: {
      body: {
        type: 'object',
        properties: {
          username:      { type: 'string', minLength: 2, maxLength: 50 },
          system_prompt: { type: 'string', maxLength: 2000 },
        },
      },
    },
  }, async (request, reply) => {
    const db = getDb();
    const { username, system_prompt } = request.body;
    const updates = [];
    const vals = [];

    if (username !== undefined)      { updates.push('username = ?');      vals.push(username); }
    if (system_prompt !== undefined) { updates.push('system_prompt = ?'); vals.push(system_prompt); }

    if (!updates.length) return reply.code(400).send({ error: 'Nothing to update' });

    updates.push("updated_at = datetime('now')");
    vals.push(request.user.id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...vals);

    return { success: true };
  });
}

module.exports = authRoutes;
