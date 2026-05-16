'use strict';
require('dotenv').config();
const path = require('path');
const Fastify = require('fastify');
const { initDb } = require('./db/database');

// ── Init DB before anything else ──────────────────────────────
initDb();

// ── Server setup ──────────────────────────────────────────────
const fastify = Fastify({
  logger: process.env.NODE_ENV !== 'production',
  trustProxy: true,
  bodyLimit: 1048576,
});

// ── Global Process Safety Catchers (Prevents Railway 502 Crashes) ──
process.on('uncaughtException', (err) => {
  console.error('CRITICAL UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('CRITICAL UNHANDLED REJECTION AT:', promise, 'REASON:', reason);
});

// ── Global Fastify Error Handling ──────────────────────────────
fastify.setErrorHandler(function (error, request, reply) {
  request.log.error(error);
  
  if (error.validation) {
    return reply.status(400).send({
      error: 'Validation Failed',
      message: error.message,
      details: error.validation
    });
  }

  reply.status(500).send({ 
    error: 'Internal Server Error', 
    message: error.message || 'An unexpected backend failure occurred.' 
  });
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

// Serve Static Assets
fastify.register(require('@fastify/static'), {
  root: path.resolve(__dirname, '../public'),
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
  const port = Number(process.env.PORT) || 3000;
  const host = '0.0.0.0'; // Essential configuration for Railway edge binding
  
  try {
    await fastify.listen({ port, host });
    console.log(`[SERVER] AETHER running smoothly on http://${host}:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
