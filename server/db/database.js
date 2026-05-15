'use strict';
/**
 * AETHER — Database Layer
 * Uses Node 22+ built-in `node:sqlite` — zero native compilation needed.
 * API mirrors better-sqlite3: prepare/run/get/all work identically.
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || './aether.db';

let db;

function getDb() {
  if (db) return db;

  db = new DatabaseSync(path.resolve(DB_PATH));

  // WAL mode + performance pragmas
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA cache_size = -8000"); // 8MB cache
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA temp_store = MEMORY");

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
      last_reset_date TEXT    NOT NULL DEFAULT (date('now')),
      system_prompt   TEXT    DEFAULT '',
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title       TEXT    NOT NULL DEFAULT 'New Conversation',
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
