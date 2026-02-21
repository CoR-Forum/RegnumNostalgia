/**
 * Login & Session Management
 * 
 * Lightweight entry point loaded BEFORE any game assets.
 * Handles session validation, login form, and realm selection.
 * After successful authentication, dynamically loads the game.
 */

import './styles/login.css';

const API_BASE = '/api';

// ── Session token from localStorage ──
function getSessionToken() {
  try {
    const raw = localStorage.getItem('sessionToken');
    if (raw && raw !== 'null' && raw !== 'undefined' && String(raw).trim() !== '') return raw;
  } catch (e) { /* ignore */ }
  return null;
}

let sessionToken = getSessionToken();
let userId = null;
let username = null;
let realm = null;

// ── Lightweight API helper (no game deps) ──

async function loginApiCall(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    ...options.headers,
  };
  if (sessionToken && !options.skipAuth) {
    headers['X-Session-Token'] = sessionToken;
  }
  const response = await fetch(API_BASE + endpoint, {
    cache: 'no-store',
    ...options,
    headers,
  });
  let data = null;
  try { data = await response.json(); } catch (e) { /* ignore */ }
  if (!response.ok) {
    const err = new Error(data?.error || 'API call failed');
    err.status = response.status;
    throw err;
  }
  if (data && data.success === false) {
    const err = new Error(data.error || 'API call failed');
    err.status = response.status;
    throw err;
  }
  return data;
}

// ── Screen management ──

function showScreen(screen) {
  const loginScreen = document.getElementById('login-screen');
  const loadingScreen = document.getElementById('loading-screen');
  const gameContainer = document.getElementById('game-container');

  loginScreen.style.display = screen === 'login' ? 'flex' : 'none';
  loadingScreen.style.display = screen === 'loading' ? 'flex' : 'none';
  // Game container is shown behind loading screen during init, then stays visible
  if (screen === 'game') {
    gameContainer.style.display = 'block';
  } else if (screen === 'loading') {
    // Show game container behind loading overlay so Leaflet can measure the map div
    gameContainer.style.display = 'block';
  } else {
    gameContainer.style.display = 'none';
  }
}

// ── Loading progress ──

function updateLoadingProgress(message, percent) {
  const bar = document.getElementById('loading-bar-fill');
  const text = document.getElementById('loading-status');
  if (bar) bar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  if (text) text.textContent = message;
}

// ── Dynamic script/CSS loaders ──

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load: ${src}`));
    document.head.appendChild(script);
  });
}

function loadCSS(href) {
  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = resolve;
    link.onerror = () => reject(new Error(`Failed to load: ${href}`));
    document.head.appendChild(link);
  });
}

// ── Game loading (after successful authentication) ──

async function startGameLoading() {
  showScreen('loading');

  try {
    // 1. Load map engine (Leaflet)
    updateLoadingProgress('Loading map engine...', 5);
    await Promise.all([
      loadCSS('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'),
      loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'),
    ]);

    // 2. Load network layer (Socket.IO)
    updateLoadingProgress('Loading network layer...', 15);
    await loadScript('https://cdn.socket.io/4.6.1/socket.io.min.js');

    // 3. Load game modules (Vite-bundled ES modules)
    updateLoadingProgress('Loading game modules...', 25);
    const { loadGame } = await import('./main');

    // 4. Load non-module game scripts (regions, screenshots, paths)
    //    Must load BEFORE game init so globals like initRegionDisplay are available
    updateLoadingProgress('Loading world data...', 30);
    await Promise.all([
      loadScript('/regions.js'),
      loadScript('/screenshotManager.js'),
      loadScript('/build-path.js'),
    ]);

    // 5. Run game initialization with progress reporting
    await loadGame(
      { sessionToken, userId, username, realm },
      updateLoadingProgress
    );

    // Done
    updateLoadingProgress('Ready!', 100);
    await new Promise((r) => setTimeout(r, 400));

    showScreen('game');
  } catch (err) {
    console.error('[Login] Game loading failed:', err);
    updateLoadingProgress('Failed to load game. Please refresh.', 0);
    // Auto-refresh after a delay
    setTimeout(() => window.location.reload(), 3000);
  }
}

// ── Realm selection ──

function showRealmSelection() {
  document.getElementById('step-login').classList.remove('active');
  document.getElementById('step-realm').classList.add('active');
}

function initRealmSelection() {
  document.querySelectorAll('.realm-card').forEach((card) => {
    card.addEventListener('click', async () => {
      const selectedRealm = card.dataset.realm;
      const errorEl = document.getElementById('realm-error');
      errorEl.classList.add('hidden');

      // Disable all cards during request
      document.querySelectorAll('.realm-card').forEach((c) => (c.style.pointerEvents = 'none'));

      try {
        const formData = new URLSearchParams();
        formData.append('realm', selectedRealm);

        const data = await loginApiCall('/realm/select', {
          method: 'POST',
          body: formData,
        });

        if (!data || !data.sessionToken) throw new Error('Invalid response from server');

        sessionToken = data.sessionToken;
        realm = data.realm;
        try { localStorage.setItem('sessionToken', data.sessionToken); } catch (e) { /* ignore */ }

        await startGameLoading();
      } catch (err) {
        console.error('[Login] Realm selection failed:', err);
        errorEl.textContent = err.message || 'Failed to select realm';
        errorEl.classList.remove('hidden');
        document.querySelectorAll('.realm-card').forEach((c) => (c.style.pointerEvents = ''));
      }
    });
  });
}

// ── Login form ──

function initLoginForm() {
  const form = document.getElementById('login-form');
  const errorEl = document.getElementById('login-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const loginBtn = document.getElementById('login-btn');
    const loginText = document.getElementById('login-text');
    const loginSpinner = document.getElementById('login-spinner');

    loginBtn.disabled = true;
    loginText.style.display = 'none';
    loginSpinner.style.display = 'inline-block';
    errorEl.classList.add('hidden');

    try {
      const formData = new URLSearchParams();
      formData.append('username', usernameInput.value);
      formData.append('password', passwordInput.value);

      const data = await loginApiCall('/login', {
        method: 'POST',
        body: formData,
        skipAuth: true,
      });

      if (!data || !data.sessionToken) {
        throw new Error(data?.error || 'Login failed: missing session token');
      }

      sessionToken = data.sessionToken;
      userId = data.userId;
      username = data.username;
      realm = data.realm;

      try { localStorage.setItem('sessionToken', data.sessionToken); } catch (e) { /* ignore */ }

      if (data.needsRealmSelection) {
        showRealmSelection();
      } else {
        await startGameLoading();
      }
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
      loginBtn.disabled = false;
      loginText.style.display = 'inline';
      loginSpinner.style.display = 'none';
    }
  });
}

// ── Session check ──

async function checkSession() {
  if (!sessionToken) return false;

  const autoLoginLoading = document.getElementById('auto-login-loading');
  const loginForm = document.getElementById('login-form');

  autoLoginLoading.classList.remove('hidden');
  loginForm.style.display = 'none';

  try {
    const data = await loginApiCall('/login/validate');

    // Valid session but no realm selected
    if (!data.realm || data.realm === '') {
      autoLoginLoading.classList.add('hidden');
      loginForm.style.display = 'none';
      showRealmSelection();
      return 'needs-realm';
    }

    // Session data for game init
    userId = data.userId || userId;
    username = data.username || username;
    realm = data.realm;

    return 'valid';
  } catch (err) {
    // Session invalid — clear and show login
    sessionToken = null;
    try { localStorage.removeItem('sessionToken'); } catch (e) { /* ignore */ }
    autoLoginLoading.classList.add('hidden');
    loginForm.style.display = 'block';
    return false;
  }
}

// ── Bootstrap ──

async function init() {
  initLoginForm();
  initRealmSelection();

  const result = await checkSession();

  if (result === 'valid') {
    // Valid session with realm — go straight to game
    await startGameLoading();
  } else if (result === 'needs-realm') {
    // Valid session but needs realm — realm selection is already showing
    return;
  }
  // Otherwise: no session, login form is visible
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
