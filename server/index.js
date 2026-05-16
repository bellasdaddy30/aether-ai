'use strict';
require('dotenv').config();
const path = require('path');
const Fastify = require('fastify');
const { initDb } = require('./db/database');

// ── Init DB before anything else ──────────────────────────────
initDb();

// ── Server setup ──────────────────────────────────────────────
// Note: We removed the local HTTPS/Certs logic. 
// Railway handles SSL/HTTPS at the proxy level. Your app should be pure HTTP.
const fastify = Fastify({
  logger: process.env.NODE_ENV !== 'production',
  trustProxy: true,
  bodyLimit: 1048576,
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
      err.statusCode = 400;
      done(err);
    }
  }
);

// ── Static Files ──────────────────────────────────────────────
fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, '../public'),
  prefix: '/',
});

// ── Routes ────────────────────────────────────────────────────
fastify.register(require('./routes/auth'),   { prefix: '/api/auth' });
fastify.register(require('./routes/chat'),   { prefix: '/api/chat' });
fastify.register(require('./routes/image'),  { prefix: '/api/image' });
fastify.register(require('./routes/voice'),  { prefix: '/api/voice' });
fastify.register(require('./routes/stripe'), { prefix: '/api/stripe' });

// ── SPA fallback ──────────────────────────────────────────────
fastify.setNotFoundHandler((request, reply) => {
  const url = request.url;
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
  // Use the port Railway provides, or 3000 for local dev
  const port = Number(process.env.PORT) || 3000;
  
  // You MUST use 0.0.0.0 on Railway
  const host = '0.0.0.0'; 

  try {
    await fastify.listen({ port, host });
    console.log(`[SERVER] AETHER Online: http://${host}:${port}`);
  } catch (err) {
    console.error('Error starting server:', err);
    process.exit(1);
  }
};

start();
