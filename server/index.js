'use strict';
require('dotenv').config();
const path = require('path');
const Fastify = require('fastify');
const { initDb } = require('./db/database');

// ── Init DB before anything else ──────────────────────────────
initDb();

// ── Server setup ──────────────────────────────────────────────
const fs = require('fs');
const https = fs.existsSync('./certs/cert.pem');

const fastify = Fastify({
  logger: process.env.NODE_ENV !== 'production',
  trustProxy: true,
  bodyLimit: 1048576,
  ...(https ? {
    https: {
      key:  fs.readFileSync('./certs/key.pem'),
      cert: fs.readFileSync('./certs/cert.pem'),
    }
  } : {}),
});

// ── Plugins ───────────────────────────────────────────────────
fastify.register(require('@fastify/cors'), {
  origin: process.env.APP_URL || true,
  credentials: true,
});

fastify.register(require('@fastify/jwt'), {
  secret: process.env.JWT_SECRET || 'change-me-in-production',
  sign: { expiresIn: process.env.JWT_EXPIRES_IN || '7d' },
});

fastify.register(require('@fastify/formbody'));

// Raw body needed for Stripe webhook signature verification
fastify.addContentTypeParser(
  'application/json',
  { parseAs: 'buffer' },
  function (req, body, done) {
    req.rawBody = body;
    try {
      const str = body.toString('utf8').trim();
      done(null, str ? JSON.parse(str) : {});
    } catch (err) {
      done(err);
    }
  }
);

// ── Static files ──────────────────────────────────────────────
fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, '..', 'public'),
  prefix: '/',
  decorateReply: true,
  setHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  },
});

// ── API Routes ────────────────────────────────────────────────
fastify.register(require('./routes/auth'),   { prefix: '/api/auth' });
fastify.register(require('./routes/chat'),   { prefix: '/api/chat' });
fastify.register(require('./routes/image'),  { prefix: '/api/image' });
fastify.register(require('./routes/voice'),  { prefix: '/api/voice' });
fastify.register(require('./routes/stripe'), { prefix: '/api/stripe' });

// ── SPA fallback ──────────────────────────────────────────────
fastify.setNotFoundHandler((request, reply) => {
  const url = request.url;
  // Serve HTML pages
  if (!url.startsWith('/api') && !url.includes('.')) {
    const page = url === '/app' ? 'app.html' : url === '/vr' ? 'vr.html' : 'index.html';
    return reply.sendFile(page);
  }
  reply.code(404).send({ error: 'Not found' });
});

// ── Health check ──────────────────────────────────────────────
fastify.get('/health', async () => ({
  status: 'ok',
  version: '1.0.0',
  env: process.env.NODE_ENV,
  uptime: process.uptime(),
}));

// ── Start ─────────────────────────────────────────────────────
const start = async () => {
  const port = parseInt(process.env.PORT || '3000');
  const host = process.env.HOST || '0.0.0.0';

  try {
    await fastify.listen({ port, host });
    console.log(`\n🌌 AETHER is live at http://localhost:${port}\n`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGINT', async () => {
  await fastify.close();
  process.exit(0);
});

start();
