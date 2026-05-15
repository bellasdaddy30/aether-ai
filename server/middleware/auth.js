'use strict';
const { getDb } = require('../db/database');

async function authMiddleware(request, reply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
}

function resetCounters(userId) {
  const db = getDb();
  const user = db.prepare('SELECT last_reset_date FROM users WHERE id = ?').get(userId);
  if (!user) return;
  const today = new Date().toISOString().split('T')[0];
  if (user.last_reset_date !== today) {
    db.prepare('UPDATE users SET messages_today = 0, images_today = 0, last_reset_date = ? WHERE id = ?').run(today, userId);
  }
}

async function loadUser(request, reply) {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(request.user.id);
  if (!user) return reply.code(404).send({ error: 'User not found' });
  resetCounters(user.id);
  request.dbUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
}

module.exports = { authMiddleware, loadUser };
