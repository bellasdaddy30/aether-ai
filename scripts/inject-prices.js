#!/usr/bin/env node
/**
 * AETHER — Price ID Injector
 * Reads STRIPE_PRICE_* from .env and replaces __STRIPE_PRICE_*__ 
 * placeholders in public HTML files so the frontend knows which
 * price IDs to pass to the checkout endpoint.
 *
 * Run: node scripts/inject-prices.js
 */

'use strict';
require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const replacements = {
  '__STRIPE_PRICE_BASICS__':  process.env.STRIPE_PRICE_BASICS  || '',
  '__STRIPE_PRICE_ELITE__':   process.env.STRIPE_PRICE_ELITE   || '',
  '__STRIPE_PRICE_GODMODE__': process.env.STRIPE_PRICE_GODMODE || '',
  '__STRIPE_PK__':            process.env.STRIPE_PUBLISHABLE_KEY || '',
};

const files = [
  path.resolve(__dirname, '../public/index.html'),
  path.resolve(__dirname, '../public/pricing.html'),
  path.resolve(__dirname, '../public/app.html'),
];

let allSet = true;
Object.entries(replacements).forEach(([k, v]) => {
  if (!v) { console.warn(`[WARN] ${k} is not set in .env`); allSet = false; }
});
if (!allSet) console.warn('[WARN] Some price IDs are missing — checkout buttons may not work.\n');

files.forEach(file => {
  if (!fs.existsSync(file)) return;
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;

  Object.entries(replacements).forEach(([placeholder, value]) => {
    if (content.includes(placeholder)) {
      content = content.replaceAll(placeholder, value);
      changed = true;
    }
  });

  if (changed) {
    fs.writeFileSync(file, content, 'utf8');
    console.log(`[OK] Injected price IDs into ${path.basename(file)}`);
  }
});

console.log('\nDone. Restart your server if it is currently running.\n');
