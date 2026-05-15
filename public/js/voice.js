/* ============================================================
   AETHER — Voice Module (voice.js)
   STT: Web Speech API (free, client-side)
   TTS: ElevenLabs via server proxy (Elite/God-Mode)
   ============================================================ */

'use strict';

const VOICE = {
  recognition: null,
  isListening: false,
  currentAudio: null,
};

// ── Speech-to-Text (Web Speech API) ────────────────────────
function initSTT() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('[Voice] Web Speech API not supported');
    document.getElementById('voiceBtn').style.opacity = '0.3';
    document.getElementById('voiceBtn').title = 'Voice input not supported in this browser';
    return false;
  }

  VOICE.recognition = new SpeechRecognition();
  VOICE.recognition.continuous = false;
  VOICE.recognition.interimResults = true;
  VOICE.recognition.lang = 'en-US';
  VOICE.recognition.maxAlternatives = 1;

  VOICE.recognition.onstart = () => {
    VOICE.isListening = true;
    document.getElementById('voiceBtn').classList.add('recording');
    document.getElementById('voiceBtn').title = 'Listening… click to stop';
  };

  VOICE.recognition.onresult = (e) => {
    const transcript = Array.from(e.results)
      .map(r => r[0].transcript)
      .join('');

    const input = document.getElementById('chatInput');
    input.value = transcript;
    autoResize(input);

    if (e.results[e.results.length - 1].isFinal) {
      stopVoice();
    }
  };

  VOICE.recognition.onerror = (e) => {
    console.error('[STT] Error:', e.error);
    stopVoice();
    if (e.error === 'not-allowed') {
      toast('Microphone access denied', 'error');
    }
  };

  VOICE.recognition.onend = () => {
    stopVoice();
  };

  return true;
}

function toggleVoice() {
  if (VOICE.isListening) {
    stopVoice();
  } else {
    startVoice();
  }
}

function startVoice() {
  if (!VOICE.recognition) {
    const ok = initSTT();
    if (!ok) { toast('Voice input not supported in this browser', 'error'); return; }
  }
  try {
    VOICE.recognition.start();
  } catch (e) {
    console.warn('[STT] Already started:', e);
  }
}

function stopVoice() {
  VOICE.isListening = false;
  document.getElementById('voiceBtn').classList.remove('recording');
  document.getElementById('voiceBtn').title = 'Voice input';
  if (VOICE.recognition) {
    try { VOICE.recognition.stop(); } catch {}
  }
}

// ── Text-to-Speech (ElevenLabs via proxy) ──────────────────
async function playTTS(text) {
  if (!text || !text.trim()) return;

  // Stop any currently playing audio
  if (VOICE.currentAudio) {
    VOICE.currentAudio.pause();
    VOICE.currentAudio = null;
  }

  const ttsBtn = document.getElementById('ttsBtn');
  ttsBtn.textContent = '⏳';

  try {
    const res = await fetch('/api/voice/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + getToken(),
      },
      body: JSON.stringify({ text: text.substring(0, 2500) }),
    });

    if (res.status === 403) {
      toast('Voice synthesis requires Elite or God-Mode', 'info');
      ttsBtn.textContent = '🔊';
      return;
    }

    if (!res.ok) {
      throw new Error('TTS request failed');
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    VOICE.currentAudio = new Audio(url);
    VOICE.currentAudio.play();

    ttsBtn.textContent = '🔊';

    VOICE.currentAudio.onended = () => {
      URL.revokeObjectURL(url);
      VOICE.currentAudio = null;
    };

  } catch (err) {
    console.error('[TTS] Error:', err);
    ttsBtn.textContent = '🔊';
    // Silently fail — TTS is non-critical
  }
}

// ── Init on DOM ready ───────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Lazy-init STT on first click
  document.getElementById('voiceBtn').addEventListener('click', () => {}, { once: false });
});
