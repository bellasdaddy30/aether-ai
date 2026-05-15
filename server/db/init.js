'use strict';
// Suppress Node 24 experimental SQLite warning
process.removeAllListeners('warning');
require('dotenv').config();
const { initDb } = require('./database');
initDb();
console.log('[AETHER] Database ready.');
