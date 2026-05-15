'use strict';
const { getDb } = require('../db/database');
const { authMiddleware, loadUser } = require('../middleware/auth');
const { imageLimitGuard } = require('../middleware/tier');
const { generateImage } = require('../services/replicate');

async function imageRoutes(fastify) {
  const preHandler = [authMiddleware, loadUser, imageLimitGuard()];

  // POST /api/image/generate
  fastify.post('/generate', {
    preHandler,
    schema: {
      body: {
        type: 'object',
        required: ['prompt'],
        properties: {
          prompt:         { type: 'string', minLength: 3, maxLength: 1000 },
          negativePrompt: { type: 'string', maxLength: 500 },
        },
      },
    },
  }, async (request, reply) => {
    const db = getDb();
    const user = request.dbUser;
    const { prompt, negativePrompt = '' } = request.body;

    try {
      const imageUrl = await generateImage({
        prompt,
        tier: user.tier,
        negativePrompt,
      });

      db.prepare(`
        INSERT INTO generated_images (user_id, prompt, url, model)
        VALUES (?, ?, ?, ?)
      `).run(user.id, prompt, imageUrl, user.tier);

      db.prepare(`UPDATE users SET images_today = images_today + 1 WHERE id = ?`).run(user.id);

      return { url: imageUrl, prompt };
    } catch (err) {
      return reply.code(500).send({ error: 'Image generation failed', detail: err.message });
    }
  });

  // GET /api/image/history
  fastify.get('/history', { preHandler: [authMiddleware, loadUser] }, async (request) => {
    const db = getDb();
    return db.prepare(`
      SELECT id, prompt, url, model, created_at FROM generated_images
      WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
    `).all(request.user.id);
  });
}

module.exports = imageRoutes;
