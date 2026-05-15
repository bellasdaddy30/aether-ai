'use strict';
const fetch = require('node-fetch');
const { authMiddleware, loadUser } = require('../middleware/auth');
const { tierGuard } = require('../middleware/tier');

const EL_BASE  = 'https://api.elevenlabs.io/v1';
const EL_KEY   = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';

const VOICE_TIERS = ['elite', 'godmode'];

async function voiceRoutes(fastify) {
  // POST /api/voice/tts — Text-to-Speech proxy
  fastify.post('/tts', {
    preHandler: [authMiddleware, loadUser, tierGuard(VOICE_TIERS)],
    schema: {
      body: {
        type: 'object',
        required: ['text'],
        properties: {
          text:    { type: 'string', minLength: 1, maxLength: 2500 },
          voiceId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { text, voiceId = VOICE_ID } = request.body;

    if (!EL_KEY) {
      return reply.code(503).send({ error: 'TTS service not configured' });
    }

    try {
      const res = await fetch(`${EL_BASE}/text-to-speech/${voiceId}/stream`, {
        method: 'POST',
        headers: {
          'xi-api-key': EL_KEY,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_turbo_v2',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.2,
            use_speaker_boost: true,
          },
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        return reply.code(res.status).send({ error: `TTS error: ${err}` });
      }

      reply.raw.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Transfer-Encoding': 'chunked',
      });

      res.body.pipe(reply.raw);
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // GET /api/voice/voices — list available voices
  fastify.get('/voices', {
    preHandler: [authMiddleware, loadUser, tierGuard(VOICE_TIERS)],
  }, async (request, reply) => {
    if (!EL_KEY) return reply.code(503).send({ error: 'TTS not configured' });

    try {
      const res = await fetch(`${EL_BASE}/voices`, {
        headers: { 'xi-api-key': EL_KEY },
      });
      const data = await res.json();
      const voices = (data.voices || []).map(v => ({
        id: v.voice_id,
        name: v.name,
        category: v.category,
        preview: v.preview_url,
      }));
      return voices;
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // GET /api/voice/config — client config for Web Speech API STT
  fastify.get('/config', {
    preHandler: [authMiddleware, loadUser],
  }, async (request) => {
    return {
      sttEngine: 'webSpeechAPI',  // Free, runs client-side in browser
      ttsAvailable: VOICE_TIERS.includes(request.dbUser.tier) && !!EL_KEY,
      tier: request.dbUser.tier,
    };
  });
}

module.exports = voiceRoutes;
