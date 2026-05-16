'use strict';
/**
 * AETHER — Database Layer
 * Uses battle-tested better-sqlite3 for synchronous performance and safety.
 */
const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || './aether.db';

let db;

function getDb() {
  if (db) return db;

  // Initialize better-sqlite3 instead of native experimental module
  db = new Database(path.resolve(DB_PATH));

  // WAL mode + production-grade performance pragmas
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -8000"); // 8MB cache
  db.pragma("foreign_keys = ON");
  db.pragma("temp_store = MEMORY");

  return db;
}

function initDb() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      email       TEXT    UNIQUE NOT NULL,
      password    TEXT    NOT NULL,
      username    TEXT    NOT NULL,
      tier        TEXT    NOT NULL DEFAULT 'free',
      stripe_customer_id   TEXT,
      stripe_subscription_id TEXT,
      subscription_status  TEXT DEFAULT 'inactive',
      messages_today  INTEGER NOT NULL DEFAULT 0,
      images_today    INTEGER NOT NULL DEFAULT 0,
      last_reset_date TEXT    NOT NULL,
      system_prompt   TEXT,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title       TEXT    NOT NULL,
      model       TEXT    NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role            TEXT    NOT NULL CHECK(role IN ('user','assistant','system')),
      content         TEXT    NOT NULL,
      tokens_used     INTEGER DEFAULT 0,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS generated_images (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      prompt      TEXT    NOT NULL,
      url         TEXT    NOT NULL,
      model       TEXT    NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stripe_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id    TEXT    UNIQUE NOT NULL,
      type        TEXT    NOT NULL,
      processed   INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
    CREATE INDEX IF NOT EXISTS idx_images_user ON generated_images(user_id);
  `);

  console.log('[DB] Schema initialized at', DB_PATH);
  return db;
}

module.exports = { getDb, initDb };
