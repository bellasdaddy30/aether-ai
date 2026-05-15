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
  const res = await fetch('/api' + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': getToken() ? 'Bearer ' + getToken() : undefined,
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.message || 'Request failed');
  return data;
}

// ── Toast ──────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 3500) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// ── Auth Flow ──────────────────────────────────────────────
let authMode = 'login';

function switchAuthTab(mode) {
  authMode = mode;
  document.getElementById('loginTab').classList.toggle('active', mode === 'login');
  document.getElementById('registerTab').classList.toggle('active', mode === 'register');
  document.getElementById('usernameField').style.display = mode === 'register' ? '' : 'none';
  document.getElementById('authError').style.display = 'none';
  document.getElementById('authSubmitBtn').textContent = mode === 'login' ? 'Enter' : 'Create Account';
}

async function handleAuth() {
  const email    = document.getElementById('emailInput').value.trim();
  const password = document.getElementById('passwordInput').value;
  const username = document.getElementById('usernameInput').value.trim();
  const errEl    = document.getElementById('authError');

  errEl.style.display = 'none';

  if (!email || !password) {
    errEl.textContent = 'Email and password required';
    errEl.style.display = 'block';
    return;
  }

  const btn = document.getElementById('authSubmitBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  try {
    const body = authMode === 'login'
      ? { email, password }
      : { email, password, username: username || email.split('@')[0] };

    const data = await api('/auth/' + authMode, { method: 'POST', body });
    saveToken(data.token);
    STATE.user = data.user;
    await initApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = authMode === 'login' ? 'Enter' : 'Create Account';
  }
}

// ── App Init ───────────────────────────────────────────────
async function initApp() {
  const token = getToken();
  if (!token) { showAuthModal(); return; }

  try {
    const user = await api('/auth/me');
    STATE.user = user;
    renderUserInfo(user);
    await loadConversations();
    document.getElementById('authModal').classList.remove('open');
    document.getElementById('appShell').style.display = '';

    // Show VR tab for God-Mode
    if (user.tier === 'godmode') {
      document.getElementById('vrTabBtn').style.display = '';
    }

    // Handle upgrade intent from pricing page
    const params = new URLSearchParams(location.search);
    if (params.get('upgrade') === 'success') {
      toast('Welcome to ' + user.tier.toUpperCase() + '! Your upgrade is active.', 'success', 5000);
      history.replaceState({}, '', '/app');
    }
    if (params.get('intent') === 'upgrade') {
      window.location.href = '/pricing';
    }
  } catch {
    clearToken();
    showAuthModal();
  }
}

function showAuthModal() {
  document.getElementById('authModal').classList.add('open');
  document.getElementById('appShell').style.display = 'none';
}

function renderUserInfo(user) {
  document.getElementById('tierBadge').textContent = user.tier.toUpperCase();
  document.getElementById('userName').textContent = user.username || user.email;
  document.getElementById('userAvatar').textContent = (user.username || user.email).charAt(0).toUpperCase();

  const modelMap = {
    free:    'Mistral 7B',
    basics:  'Mistral 7B',
    elite:   'Hermes 70B',
    godmode: 'Claude Sonnet',
  };
  document.getElementById('modelDisplay').textContent = modelMap[user.tier] || '—';

  const limit = { free: 5, basics: 50, elite: 500, godmode: '∞' };
  const used = user.messages_today || 0;
  const max = limit[user.tier];
  document.getElementById('msgCounter').textContent =
    max === '∞' ? '∞ messages' : `${used}/${max} msgs today`;
}

function logout() {
  clearToken();
  STATE.user = null;
  STATE.conversations = [];
  STATE.currentConvId = null;
  document.getElementById('conversationList').innerHTML = '';
  document.getElementById('messagesInner').innerHTML = '';
  showAuthModal();
}

// ── Conversations ──────────────────────────────────────────
async function loadConversations() {
  try {
    const convs = await api('/chat/conversations');
    STATE.conversations = convs;
    renderConversationList();
  } catch {}
}

function renderConversationList() {
  const list = document.getElementById('conversationList');
  list.innerHTML = '';

  if (!STATE.conversations.length) {
    list.innerHTML = '<div style="padding:1.5rem 1.25rem;font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim);letter-spacing:0.1em;">No conversations yet</div>';
    return;
  }

  STATE.conversations.forEach(conv => {
    const item = document.createElement('div');
    item.className = 'conv-item' + (conv.id === STATE.currentConvId ? ' active' : '');
    item.dataset.id = conv.id;
    item.innerHTML = `
      <div class="conv-title">${escHtml(conv.title || 'Untitled')}</div>
      <button class="conv-delete" onclick="deleteConversation(event, ${conv.id})" title="Delete">×</button>
    `;
    item.addEventListener('click', () => loadConversation(conv.id));
    list.appendChild(item);
  });
}

async function loadConversation(id) {
  STATE.currentConvId = id;
  renderConversationList();
  clearMessages();

  try {
    const msgs = await api('/chat/conversations/' + id + '/messages');
    msgs.forEach(m => appendMessage(m.role, m.content, false));
    scrollToBottom();
  } catch (err) {
    toast('Failed to load conversation', 'error');
  }
}

async function newConversation() {
  STATE.currentConvId = null;
  clearMessages();
  renderConversationList();
  document.getElementById('chatInput').focus();
}

async function deleteConversation(e, id) {
  e.stopPropagation();
  try {
    await api('/chat/conversations/' + id, { method: 'DELETE' });
    STATE.conversations = STATE.conversations.filter(c => c.id !== id);
    if (STATE.currentConvId === id) { STATE.currentConvId = null; clearMessages(); }
    renderConversationList();
  } catch { toast('Delete failed', 'error'); }
}

// ── Messages ───────────────────────────────────────────────
function clearMessages() {
  const inner = document.getElementById('messagesInner');
  inner.innerHTML = `
    <div class="empty-state" id="emptyState">
      <div class="empty-logo">A</div>
      <div class="empty-tagline">What shall we explore?</div>
      <div class="starter-chips">
        <button class="starter-chip" onclick="sendStarter(this)">Explain quantum entanglement intuitively</button>
        <button class="starter-chip" onclick="sendStarter(this)">Write a noir short story opening</button>
        <button class="starter-chip" onclick="sendStarter(this)">What makes great product design?</button>
        <button class="starter-chip" onclick="sendStarter(this)">Debate: free will vs determinism</button>
      </div>
    </div>`;
}

function appendMessage(role, content, animate = true) {
  const emptyState = document.getElementById('emptyState');
  if (emptyState) emptyState.remove();

  const inner = document.getElementById('messagesInner');
  const el = document.createElement('div');
  el.className = 'message ' + role;
  el.innerHTML = `
    <div class="message-header">
      <span class="message-role">${role === 'assistant' ? 'AETHER' : 'YOU'}</span>
    </div>
    <div class="message-content">${formatContent(content)}</div>`;
  inner.appendChild(el);
  if (animate) scrollToBottom();
  return el;
}

function appendStreamingMessage() {
  const emptyState = document.getElementById('emptyState');
  if (emptyState) emptyState.remove();

  const inner = document.getElementById('messagesInner');
  const el = document.createElement('div');
  el.className = 'message assistant';
  el.innerHTML = `
    <div class="message-header">
      <span class="message-role">AETHER</span>
    </div>
    <div class="message-content typing-cursor" id="streamingContent"></div>`;
  inner.appendChild(el);
  scrollToBottom();
  return document.getElementById('streamingContent');
}

function formatContent(text) {
  // Basic markdown: code blocks, inline code, bold, italic, line breaks
  return text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n\n+/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>').replace(/$/, '</p>');
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function scrollToBottom() {
  const c = document.getElementById('messagesContainer');
  c.scrollTop = c.scrollHeight;
}

// ── Send Message ───────────────────────────────────────────
async function sendMessage() {
  if (STATE.isStreaming) return;

  const input = document.getElementById('chatInput');
  const text  = input.value.trim();
  if (!text) return;

  input.value = '';
  input.style.height = '';
  appendMessage('user', text);
  scrollToBottom();

  STATE.isStreaming = true;
  document.getElementById('sendBtn').disabled = true;

  const contentEl = appendStreamingMessage();
  let fullText = '';

  try {
    const res = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
         'Authorization': getToken() ? 'Bearer ' + getToken() : undefined,
      },
      body: JSON.stringify({
        message: text,
        conversationId: STATE.currentConvId,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Stream failed');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;

        try {
          const parsed = JSON.parse(data);
          if (parsed.error) throw new Error(parsed.error);
          if (parsed.delta) {
            fullText += parsed.delta;
            contentEl.innerHTML = formatContent(fullText);
            contentEl.classList.add('typing-cursor');
            if (parsed.convId && !STATE.currentConvId) {
              STATE.currentConvId = parsed.convId;
              await loadConversations();
            }
            scrollToBottom();
          }
        } catch (parseErr) {
          if (parseErr.message !== 'Unexpected end of JSON input') {
            throw parseErr;
          }
        }
      }
    }

    contentEl.classList.remove('typing-cursor');

    // TTS playback if enabled
    if (STATE.ttsEnabled && fullText) {
      playTTS(fullText.substring(0, 500));
    }

    // Update usage counter
    if (STATE.user) {
      STATE.user.messages_today = (STATE.user.messages_today || 0) + 1;
      renderUserInfo(STATE.user);
    }

  } catch (err) {
    contentEl.classList.remove('typing-cursor');
    if (err.message.includes('limit')) {
      contentEl.innerHTML = `<span style="color:var(--gold-dim)">Daily message limit reached. <a href="/pricing" style="color:var(--gold);">Upgrade your plan →</a></span>`;
    } else {
      contentEl.innerHTML = `<span style="color:var(--error)">Error: ${escHtml(err.message)}</span>`;
    }
  } finally {
    STATE.isStreaming = false;
    document.getElementById('sendBtn').disabled = false;
    document.getElementById('chatInput').focus();
  }
}

function sendStarter(btn) {
  document.getElementById('chatInput').value = btn.textContent;
  sendMessage();
}

function handleInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function autoResize(el) {
  el.style.height = '';
  el.style.height = Math.min(el.scrollHeight, 180) + 'px';
}

// ── Tabs ───────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.textContent.toLowerCase() === tab));
  document.querySelectorAll('.tab-panel').forEach(p =>
    p.classList.toggle('active', p.id === tab + 'Panel'));
  if (tab === 'account' && STATE.user) populateAccountTab(STATE.user);
}

function openVR() {
  window.open('/vr', '_blank');
}

// ── Settings ───────────────────────────────────────────────
function openSettings() {
  document.getElementById('settingsUsername').value = STATE.user?.username || '';
  document.getElementById('settingsSystemPrompt').value = STATE.user?.system_prompt || '';
  document.getElementById('settingsModal').classList.add('open');
}

function closeSettings() {
  document.getElementById('settingsModal').classList.remove('open');
}

async function saveSettings() {
  const username = document.getElementById('settingsUsername').value.trim();
  const system_prompt = document.getElementById('settingsSystemPrompt').value;
  try {
    await api('/auth/me', { method: 'PATCH', body: { username, system_prompt } });
    if (STATE.user) {
      STATE.user.username = username;
      STATE.user.system_prompt = system_prompt;
      renderUserInfo(STATE.user);
    }
    closeSettings();
    toast('Settings saved', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function openBillingPortal() {
  try {
    const data = await api('/stripe/portal', { method: 'POST' });
    if (data?.url) window.location.href = data.url;
  } catch (err) {
    toast('Could not open billing portal: ' + err.message, 'error');
  }
}

// ── TTS toggle (client side) ───────────────────────────────
function toggleTTS() {
  STATE.ttsEnabled = !STATE.ttsEnabled;
  document.getElementById('ttsBtn').classList.toggle('active', STATE.ttsEnabled);
  toast(STATE.ttsEnabled ? 'Voice playback on' : 'Voice playback off', 'info', 2000);
}

// ── Boot ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initApp);

// ── Account Tab ─────────────────────────────────────────────
function populateAccountTab(user) {
  const tierLabels = { free:'Free',basics:'Basics',elite:'Elite',godmode:'God-Mode' };
  const el = id => document.getElementById(id);
  if (el('acct-tier'))     el('acct-tier').textContent     = tierLabels[user.tier] || user.tier;
  if (el('acct-status'))   el('acct-status').textContent   = user.subscription_status === 'active' ? 'Active subscription' : user.tier === 'free' ? 'Free plan' : user.subscription_status || '';
  if (el('acct-msgs'))     el('acct-msgs').textContent     = user.messages_today || 0;
  if (el('acct-imgs'))     el('acct-imgs').textContent     = user.images_today || 0;
  if (el('acct-username')) el('acct-username').value       = user.username || '';
  if (el('acct-persona'))  el('acct-persona').value        = user.system_prompt || '';
}

async function saveAccountSettings() {
  const username      = document.getElementById('acct-username').value.trim();
  const system_prompt = document.getElementById('acct-persona').value;
  try {
    await api('/auth/me', { method: 'PATCH', body: { username, system_prompt } });
    if (STATE.user) {
      STATE.user.username      = username;
      STATE.user.system_prompt = system_prompt;
      renderUserInfo(STATE.user);
    }
    toast('Saved', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// Populate account tab when switching to it
const _origSwitch = window.switchTab;
window.switchTab = function(tab) {
  _origSwitch(tab);
  if (tab === 'account' && STATE.user) populateAccountTab(STATE.user);
};

// ── Session: clear token on tab/browser close ────────────────
window.addEventListener('beforeunload', () => {
  localStorage.removeItem('aether_token');
});

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
      STATE.user.username      = username;
      STATE.user.system_prompt = system_prompt;
      renderUserInfo(STATE.user);
    }
    toast('Saved', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}
