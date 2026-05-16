/* ============================================================
   AETHER — App Core (app.js)
   Auth, chat streaming, conversation management, UI state
   ============================================================ */

'use strict';

// ── State ──────────────────────────────────────────────────
const STATE = {
  token: null,
  user: null,
  currentConvId: null,
  conversations: [],
  isStreaming: false,
  ttsEnabled: false,
};

// ── Token helpers ──────────────────────────────────────────
function getToken() { return STATE.token || localStorage.getItem('aether_token'); }
function saveToken(t) { STATE.token = t; localStorage.setItem('aether_token', t); }
function clearToken() { STATE.token = null; localStorage.removeItem('aether_token'); }

// ── API ────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {\n    ...opts,\n    headers: {\n      'Content-Type': 'application/json',\n      'Authorization': getToken() ? 'Bearer ' + getToken() : undefined,\n      ...(opts.headers || {}),\n    },\n    body: opts.body ? JSON.stringify(opts.body) : undefined,\n  });\n  if (res.status === 204) return null;\n  const data = await res.json();\n  if (!res.ok) throw new Error(data.error || data.message || 'Request failed');\n  return data;\n}

// ── Toast ──────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 3500) {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;bottom:2rem;right:2rem;background:var(--surface-high);border:1px solid var(--border);padding:0.8rem 1.2rem;font-family:var(--font-mono);font-size:0.65rem;color:${type==='error'?'var(--error)':type==='success'?'var(--success)':'var(--gold-bright)'};z-index:9999;box-shadow:0 10px 30px rgba(0,0,0,0.5);letter-spacing:0.05em;text-transform:uppercase;`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// ── Intercept Upgrade Intent Queries ─────────────────────────
function checkUpgradeIntent() {
  const urlParams = new URLSearchParams(window.location.search);
  const intent = urlParams.get('intent');
  const tier = urlParams.get('tier');

  if (intent === 'upgrade' && tier && getToken()) {
    console.log(`[UPGRADE] Context authorized, bouncing to pricing for tier: ${tier}`);
    window.location.href = '/pricing.html?tier=' + tier;
  }
}

// ── Account Tab Functions ────────────────────────────────────
function populateAccountTab(user) {
  const tierLabels = { free:'Free', basics:'Basics', elite:'Elite', godmode:'God-Mode' };
  const el = id => document.getElementById(id);
  if (el('acct-tier'))     el('acct-tier').textContent   = tierLabels[user.tier] || user.tier;
  if (el('acct-status'))   el('acct-status').textContent = user.subscription_status === 'active' ? 'Active subscription' : user.tier === 'free' ? 'Free plan' : user.subscription_status || '';
  if (el('acct-msgs'))     el('acct-msgs').textContent   = user.messages_today || 0;
  if (el('acct-imgs'))     el('acct-imgs').textContent   = user.images_today || 0;
  if (el('acct-username')) el('acct-username').value     = user.username || '';
  if (el('acct-persona'))  el('acct-persona').value      = user.system_prompt || '';
}

async function saveAccountSettings() {
  const username      = document.getElementById('acct-username').value.trim();
  const system_prompt = document.getElementById('acct-persona').value;
  try {
    await api('/auth/me', { method: 'PATCH', body: { username, system_prompt } });
    if (STATE.user) {
      STATE.user.username = username;
      STATE.user.system_prompt = system_prompt;
      toast('Profile updated successfully', 'success');
    }
  } catch (err) {
    toast(err.message, 'error');
  }
}

// Check upgrade workflows upon layout instantiation
document.addEventListener('DOMContentLoaded', () => {
  if (getToken()) {
    checkUpgradeIntent();
  }
});
