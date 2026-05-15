'use strict';
const { getTierLimits } = require('../services/openrouter');

function tierGuard(requiredTiers = []) {
  return async function (request, reply) {
    const user = request.dbUser;
    if (!user) return reply.code(401).send({ error: 'Unauthorized' });

    const allowed = requiredTiers.length === 0 || requiredTiers.includes(user.tier);
    if (!allowed) {
      return reply.code(403).send({
        error: 'Upgrade required',
        message: `This feature requires one of: ${requiredTiers.join(', ')}`,
        currentTier: user.tier,
      });
    }
  };
}

function messageLimitGuard() {
  return async function (request, reply) {
    const user = request.dbUser;
    const limits = getTierLimits(user.tier);
    if (limits.messages !== -1 && user.messages_today >= limits.messages) {
      return reply.code(429).send({
        error: 'Daily limit reached',
        message: `You've used all ${limits.messages} messages for today. Reset at midnight UTC.`,
        limit: limits.messages,
        used: user.messages_today,
      });
    }
  };
}

function imageLimitGuard() {
  return async function (request, reply) {
    const user = request.dbUser;
    if (user.tier === 'free') {
      return reply.code(403).send({ error: 'Image generation requires a paid plan' });
    }
    const limits = getTierLimits(user.tier);
    if (limits.images !== -1 && user.images_today >= limits.images) {
      return reply.code(429).send({
        error: 'Daily image limit reached',
        limit: limits.images,
        used: user.images_today,
      });
    }
  };
}

module.exports = { tierGuard, messageLimitGuard, imageLimitGuard };
