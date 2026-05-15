/* ============================================================
   AETHER — Image Module (image.js)
   Handles image generation UI, history loading, display
   ============================================================ */

'use strict';

const IMG_STATE = {
  isGenerating: false,
  history: [],
};

// ── Generate Image ──────────────────────────────────────────
async function generateImage() {
  if (IMG_STATE.isGenerating) return;

  const prompt   = document.getElementById('imagePrompt').value.trim();
  const negative = document.getElementById('imageNegative').value.trim();

  if (!prompt) {
    toast('Please enter a prompt', 'error');
    return;
  }

  IMG_STATE.isGenerating = true;
  const btn = document.getElementById('generateBtn');
  btn.disabled = true;

  const statusEl = document.getElementById('imageGenStatus');
  statusEl.innerHTML = `
    <div class="generating-indicator">
      <div class="generating-dots">
        <span></span><span></span><span></span>
      </div>
      <span>Synthesizing image — this may take 20–60 seconds…</span>
    </div>`;

  try {
    const res = await fetch('/api/image/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + getToken(),
      },
      body: JSON.stringify({ prompt, negativePrompt: negative }),
    });

    const data = await res.json();

    if (!res.ok) {
      if (res.status === 403) {
        statusEl.innerHTML = `
          <div class="upgrade-banner">
            <span class="upgrade-text">Image generation requires a paid plan</span>
            <a href="/pricing" class="upgrade-btn">Upgrade</a>
          </div>`;
      } else if (res.status === 429) {
        statusEl.innerHTML = `<div style="color:var(--gold-dim);font-family:var(--font-mono);font-size:0.65rem;padding:1rem 0;">Daily image limit reached. Resets at midnight UTC.</div>`;
      } else {
        throw new Error(data.detail || data.error || 'Generation failed');
      }
      return;
    }

    statusEl.innerHTML = '';
    prependImageCard(data.url, data.prompt);
    toast('Image created', 'success');

  } catch (err) {
    statusEl.innerHTML = `<div style="color:var(--error);font-family:var(--font-mono);font-size:0.65rem;padding:1rem 0;">Error: ${err.message}</div>`;
  } finally {
    IMG_STATE.isGenerating = false;
    btn.disabled = false;
  }
}

// ── Render a single image card ──────────────────────────────
function prependImageCard(url, prompt) {
  const grid = document.getElementById('imageGrid');
  const card = document.createElement('div');
  card.className = 'image-card';
  card.innerHTML = `
    <img src="${url}" alt="${escHtml(prompt)}" loading="lazy" />
    <div class="image-card-overlay">
      <div class="image-card-prompt">${escHtml(prompt.substring(0, 120))}</div>
    </div>`;

  // Click to open full size
  card.querySelector('img').addEventListener('click', () => {
    window.open(url, '_blank');
  });

  grid.prepend(card);
}

// ── Load image history ──────────────────────────────────────
async function loadImageHistory() {
  try {
    const images = await api('/image/history');
    if (!images || !images.length) return;

    const grid = document.getElementById('imageGrid');
    grid.innerHTML = '';
    images.forEach(img => prependImageCard(img.url, img.prompt));
  } catch {}
}

// ── Load history when switching to image tab ────────────────
const _origSwitchTab = window.switchTab;
window.switchTab = function(tab) {
  if (_origSwitchTab) _origSwitchTab(tab);
  if (tab === 'image' && !IMG_STATE.history.length) {
    loadImageHistory();
  }
};
