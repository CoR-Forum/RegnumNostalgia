/**
 * Window management system — drag, close, persist state, z-index stacking.
 */

import { gameState, batchUpdate } from './state.js';

// Z-index tracker for window stacking
let _topZ = 30000;

/** Get the next z-index value for bringing a window/tooltip to front. */
export function nextZIndex() { return ++_topZ; }

// ── Persisted state helpers ──

function _getWindowsState() {
  try {
    const raw = localStorage.getItem('uiWindows');
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}

function _saveWindowsState(state) {
  try { localStorage.setItem('uiWindows', JSON.stringify(state)); } catch (e) {}
}

export function saveWindowState(id, patch) {
  if (!id) return;
  const s = _getWindowsState();
  s[id] = Object.assign({}, s[id] || {}, patch || {});
  _saveWindowsState(s);
}

export function getWindowState(id) {
  const s = _getWindowsState();
  return s[id] || null;
}

// Expose for legacy non-module scripts
window.saveWindowState = saveWindowState;
window.getWindowState = getWindowState;

// ── HUD pressed state ──

export function setHudPressed(action, pressed) {
  try {
    const id = action === 'inventory' ? 'inventory-hud-btn' : (action === 'character' ? 'character-hud-btn' : null);
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    if (pressed) el.classList.add('pressed'); else el.classList.remove('pressed');
  } catch (e) { /* ignore */ }
}

// ── Drag support ──

// Store the user's intended (pre-clamp) position per window so we can
// restore it when the viewport grows large enough again.
const _intendedPositions = new Map();

export function makeDraggable(winEl, handleEl) {
  if (!winEl || !handleEl) return;
  let isDragging = false;
  let pointerOffsetX = 0;
  let pointerOffsetY = 0;
  let winW = 0;
  let winH = 0;

  const dragStart = (e) => {
    if (e.button && e.button !== 0) return;
    const rect = winEl.getBoundingClientRect();
    const computed = window.getComputedStyle(winEl);
    if (computed.right && computed.right !== 'auto') winEl.style.right = 'auto';
    if (computed.bottom && computed.bottom !== 'auto') winEl.style.bottom = 'auto';
    winEl.style.left = rect.left + 'px';
    winEl.style.top = rect.top + 'px';
    winEl.style.transform = '';
    pointerOffsetX = e.clientX - rect.left;
    pointerOffsetY = e.clientY - rect.top;
    winW = rect.width;
    winH = rect.height;
    isDragging = true;
    document.body.style.userSelect = 'none';
  };

  const drag = (e) => {
    if (!isDragging) return;
    e.preventDefault();
    let proposedLeft = e.clientX - pointerOffsetX;
    let proposedTop = e.clientY - pointerOffsetY;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    let minLeft = 0;
    let maxLeft = Math.max(0, viewportW - winW);
    let minTop = 0;
    let maxTop = Math.max(0, viewportH - winH);
    if (winW > viewportW) { minLeft = viewportW - winW; maxLeft = 0; }
    if (winH > viewportH) { minTop = viewportH - winH; maxTop = 0; }
    proposedLeft = Math.min(Math.max(proposedLeft, minLeft), maxLeft);
    proposedTop = Math.min(Math.max(proposedTop, minTop), maxTop);
    winEl.style.left = Math.round(proposedLeft) + 'px';
    winEl.style.top = Math.round(proposedTop) + 'px';
  };

  const dragEnd = () => {
    isDragging = false;
    document.body.style.userSelect = '';
    try {
      const left = parseInt(winEl.style.left, 10);
      const top = parseInt(winEl.style.top, 10);
      if (!isNaN(left) && !isNaN(top)) {
        saveWindowState(winEl.id, { left, top });
        // Update the intended position so resize clamping can restore to this spot
        _intendedPositions.set(winEl.id, { left, top });
      }
    } catch (e) {}
  };

  handleEl.addEventListener('mousedown', dragStart);
  document.addEventListener('mousemove', drag);
  document.addEventListener('mouseup', dragEnd);
}

// ── tryRestoreOpen ──

function tryRestoreOpen(id, saved) {
  if (!saved || !saved.open) return;
  const maxAttempts = 25;
  let attempts = 0;
  const tryOnce = () => {
    attempts++;
    try {
      if (id === 'inventory-window') {
        const sock = (window.getSocket && window.getSocket()) || window.socket;
        if (sock && sock.connected) { openWindow('inventory-window'); return true; }
        return false;
      }
      if (id === 'character-window') {
        const sock = (window.getSocket && window.getSocket()) || window.socket;
        if (sock && sock.connected) { openWindow('character-window'); return true; }
        return false;
      }
      if (id === 'screenshots-window' && window.screenshotManager && typeof window.screenshotManager.openModal === 'function') {
        try { window.screenshotManager.openModal(saved.contextX ?? null, saved.contextY ?? null); } catch (e) { window.screenshotManager.openModal(null, null); }
        return true;
      }
    } catch (e) { /* retry */ }
    return false;
  };
  if (tryOnce()) return;
  const iv = setInterval(() => {
    if (tryOnce() || attempts >= maxAttempts) clearInterval(iv);
  }, 200);
}

// ── initWindow ──

export function initWindow({ id, headerId, closeId, onClose, draggable = true }) {
  const win = document.getElementById(id);
  if (!win) return;

  try {
    const saved = getWindowState(id);
    if (saved) {
      if (typeof saved.left !== 'undefined' && typeof saved.top !== 'undefined') {
        try { if (win.style.right && win.style.right !== 'auto') win.style.right = 'auto'; } catch (e) {}
        try { if (win.style.bottom && win.style.bottom !== 'auto') win.style.bottom = 'auto'; } catch (e) {}
        try {
          const viewportW = window.innerWidth || document.documentElement.clientWidth || 1024;
          const viewportH = window.innerHeight || document.documentElement.clientHeight || 768;
          const savedLeft = Number(saved.left) || 0;
          const savedTop = Number(saved.top) || 0;
          let winW = win.offsetWidth || parseInt(window.getComputedStyle(win).width, 10) || 304;
          let winH = win.offsetHeight || parseInt(window.getComputedStyle(win).height, 10) || 200;
          winW = Math.max(64, winW);
          winH = Math.max(64, winH);
          const maxLeft = Math.max(0, viewportW - winW);
          const maxTop = Math.max(0, viewportH - winH);
          const left = Math.min(Math.max(0, savedLeft), maxLeft);
          const top = Math.min(Math.max(0, savedTop), maxTop);
          win.style.left = left + 'px';
          win.style.top = top + 'px';
          win.style.transform = '';
          try { saveWindowState(win.id, { left: Math.round(left), top: Math.round(top) }); } catch (e) {}
        } catch (e) {
          win.style.left = (saved.left) + 'px';
          win.style.top = (saved.top) + 'px';
          win.style.transform = '';
        }
      }
      if (saved.open) {
        win.style.display = saved.display || 'flex';
        try { if (id === 'inventory-window') setHudPressed('inventory', true); if (id === 'character-window') setHudPressed('character', true); } catch (e) {}
        tryRestoreOpen(id, saved);
      } else {
        win.style.display = 'none';
      }
    }
  } catch (e) { /* ignore */ }

  const header = headerId ? document.getElementById(headerId) : null;
  const closeBtn = closeId ? document.getElementById(closeId) : null;

  try {
    const current = parseInt(win.style.zIndex, 10);
    if (!current || current < _topZ) {
      win.style.zIndex = (nextZIndex()).toString();
    }
  } catch (e) { win.style.zIndex = (nextZIndex()).toString(); }

  const bringToFront = () => { try { win.style.zIndex = (nextZIndex()).toString(); } catch (e) {} };
  win.addEventListener('mousedown', bringToFront);
  if (header) header.addEventListener('mousedown', bringToFront);

  if (draggable && header) makeDraggable(win, header);
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      try {
        if (id === 'inventory-window') setHudPressed('inventory', false);
        if (id === 'character-window') setHudPressed('character', false);
      } catch (e) {}
      try { saveWindowState(id, { open: false, display: 'none' }); } catch (e) {}
      if (typeof onClose === 'function') onClose();
      else win.style.display = 'none';
    });
  }
  return win;
}

// ── initWindows ──

export function initWindows() {
  initWindow({ id: 'inventory-window', headerId: 'inventory-header', closeId: 'inventory-close-btn', onClose: () => closeWindow('inventory-window') });
  initWindow({ id: 'character-window', headerId: 'character-header', closeId: 'character-close-btn', onClose: () => closeWindow('character-window') });
  initWindow({ id: 'mini-info-window', headerId: null, closeId: 'mini-info-close-btn', draggable: false });
}

// Expose globally for non-module scripts
window.initWindows = initWindows;

// ── Viewport resize clamping ──

/** Clamp all visible .ui-window elements so they stay within the viewport on resize. */
function clampWindowsToViewport() {
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const windows = document.querySelectorAll('.ui-window');
  windows.forEach((win) => {
    if (!win.id) return;
    if (win.style.display === 'none' || win.offsetParent === null) return;
    const rect = win.getBoundingClientRect();

    // Capture the intended position if we haven't yet (first time, or after a drag)
    if (!_intendedPositions.has(win.id)) {
      _intendedPositions.set(win.id, { left: rect.left, top: rect.top });
    }

    const intended = _intendedPositions.get(win.id);

    // Start from the intended position — this lets windows move back when viewport grows
    let left = intended.left;
    let top = intended.top;

    // Clamp so the window stays fully within the viewport
    if (left + rect.width > viewportW) left = Math.max(0, viewportW - rect.width);
    if (top + rect.height > viewportH) top = Math.max(0, viewportH - rect.height);
    if (left < 0) left = 0;
    if (top < 0) top = 0;

    const currentLeft = Math.round(rect.left);
    const currentTop = Math.round(rect.top);
    const newLeft = Math.round(left);
    const newTop = Math.round(top);

    if (newLeft !== currentLeft || newTop !== currentTop) {
      // Clear right/bottom anchoring so left/top take effect
      if (win.style.right && win.style.right !== 'auto') win.style.right = 'auto';
      if (win.style.bottom && win.style.bottom !== 'auto') win.style.bottom = 'auto';
      win.style.transform = '';
      win.style.left = newLeft + 'px';
      win.style.top = newTop + 'px';
      try { saveWindowState(win.id, { left: newLeft, top: newTop }); } catch (e) {}
    }
  });
}

/**
 * Record the intended position for a window (call after user drags a window).
 * This ensures the resize handler knows where the user actually wants the window.
 */
export function setIntendedPosition(winId, left, top) {
  _intendedPositions.set(winId, { left, top });
}

// Expose for legacy non-module scripts
window.setIntendedPosition = setIntendedPosition;

window.addEventListener('resize', clampWindowsToViewport);

// ── Normalize window id ──

function _normalizeWindowId(id) {
  if (!id) return id;
  if (document.getElementById(id)) return id;
  const winId = id.endsWith('-window') ? id : (id + '-window');
  return document.getElementById(winId) ? winId : id;
}

// ── openWindow / closeWindow ──

export async function openWindow(id) {
  const winId = _normalizeWindowId(id);
  const base = String(winId).replace(/-window$/, '');
  const el = document.getElementById(winId);
  if (!el) return;

  // Inventory-specific initialization
  if (base === 'inventory') {
    el.style.display = 'flex';
    try { saveWindowState(winId, { open: true, display: el.style.display || 'flex' }); } catch (e) {}
    try { setHudPressed('inventory', true); } catch (e) {}
    try { document.getElementById('inventory-loading').style.display = 'block'; } catch (e) {}
    try { document.getElementById('inventory-items').style.display = 'none'; } catch (e) {}
    try { document.getElementById('inventory-empty').style.display = 'none'; } catch (e) {}

    try {
      let socket = window.getSocket && window.getSocket();
      if (!socket || !socket.connected) {
        if (window.initializeWebSocket) {
          window.initializeWebSocket();
          socket = window.getSocket && window.getSocket();
          if (socket && !socket.connected) {
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => reject(new Error('WebSocket connection timeout')), 3000);
              socket.once('connect', () => { clearTimeout(timeout); resolve(); });
            });
          }
        }
      }
      if (!socket || !socket.connected) throw new Error('WebSocket not available');
      // Lazy-import to avoid circular deps
      const { displayEquipment } = await import('./equipment.js');
      const { displayInventory } = await import('./inventory.js');
      socket.emit('equipment:get', (equipData) => { if (equipData && equipData.success) displayEquipment(equipData.equipment); });
      socket.emit('inventory:get', (invData) => { if (invData && invData.success) displayInventory(invData.items); });
    } catch (error) {
      console.error('Failed to fetch inventory:', error);
      alert('Failed to load inventory: ' + (error && error.message ? error.message : 'Unknown error'));
      try { el.style.display = 'none'; } catch (e) {}
      try { setHudPressed('inventory', false); } catch (e) {}
      try { saveWindowState(winId, { open: false, display: 'none' }); } catch (e) {}
    }
    return;
  }

  // Character-specific initialization
  if (base === 'character') {
    el.style.display = 'flex';
    try { saveWindowState(winId, { open: true, display: el.style.display || 'flex' }); } catch (e) {}
    try { setHudPressed('character', true); } catch (e) {}

    try {
      const socket = window.getSocket && window.getSocket();
      const requestStats = () => new Promise((resolve) => {
        if (socket && socket.connected) {
          socket.emit('player:stats:get', (resp) => {
            if (resp && resp.success && resp.state) return resolve(resp.state);
            resolve(null);
          });
          setTimeout(() => resolve(null), 1500);
        } else {
          resolve(null);
        }
      });

      let posData = await requestStats();
      if (!posData) {
        if (!(socket && socket.connected)) {
          posData = await new Promise((resolve) => {
            function onConnect() {
              window.removeEventListener('websocket:connected', onConnect);
              const s = window.getSocket && window.getSocket();
              if (s && s.connected) {
                s.emit('player:stats:get', (resp) => { resolve(resp && resp.success && resp.state ? resp.state : null); });
              } else resolve(null);
            }
            window.addEventListener('websocket:connected', onConnect);
            setTimeout(() => { window.removeEventListener('websocket:connected', onConnect); resolve(null); }, 10000);
          });
        }
      }

      if (posData) {
        const updates = {};
        if (typeof posData.xp !== 'undefined') updates.xp = posData.xp;
        if (typeof posData.level !== 'undefined') updates.level = posData.level;
        if (typeof posData.xpToNext !== 'undefined') updates.xpToNext = posData.xpToNext;
        if (posData.stats) updates.stats = posData.stats;
        if (typeof posData.damage !== 'undefined') updates.damage = posData.damage;
        if (typeof posData.armor !== 'undefined') updates.armor = posData.armor;
        if (typeof posData.username !== 'undefined') updates.username = posData.username;
        if (typeof posData.realm !== 'undefined') updates.realm = posData.realm;
        if (typeof posData.className !== 'undefined') updates.className = posData.className;
        if (Object.keys(updates).length) batchUpdate(updates);
      }
    } catch (err) { console.error('Failed to load character data:', err); }

    return;
  }

  // Fallback: show generic window
  el.style.display = 'flex';
  try { saveWindowState(winId, { open: true, display: el.style.display || 'flex' }); } catch (e) {}
}

export async function closeWindow(id) {
  const winId = _normalizeWindowId(id);
  const base = String(winId).replace(/-window$/, '');
  const fnName = 'close' + base.charAt(0).toUpperCase() + base.slice(1);
  if (typeof window[fnName] === 'function') {
    try { return await window[fnName](); } catch (e) { console.debug(fnName + ' failed', e); }
  }

  const el = document.getElementById(winId);
  if (!el) return;
  el.style.display = 'none';
  try { if (base === 'inventory') setHudPressed('inventory', false); if (base === 'character') setHudPressed('character', false); } catch (e) {}
  try { saveWindowState(winId, { open: false, display: 'none' }); } catch (e) {}
}

// Expose globally for non-module scripts
window.openWindow = openWindow;
window.closeWindow = closeWindow;
