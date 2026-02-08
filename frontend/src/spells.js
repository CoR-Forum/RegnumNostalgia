/**
 * Active Spells UI — shows active spell buffs to the left of the compass.
 * Listens for socket events: spell:started, spell:update, spell:expired.
 * Requests initial active spells on socket connect.
 */

import { gameState } from './state.js';

/** @type {Array<{spellId:number, spellKey:string, iconName:string, duration:number, remaining:number, healPerTick?:number, manaPerTick?:number}>} */
let activeSpells = [];

/** Local timers to tick down the countdown without waiting for server */
let localTickInterval = null;

const SPELL_NAMES = {
  health_potion: 'Health Potion',
  mana_potion: 'Mana Potion'
};

/**
 * Render the active spells into the UI container.
 */
function renderActiveSpells() {
  const container = document.getElementById('active-spells-container');
  if (!container) return;

  container.innerHTML = '';

  if (activeSpells.length === 0) {
    container.setAttribute('aria-hidden', 'true');
    return;
  }

  container.setAttribute('aria-hidden', 'false');

  for (const spell of activeSpells) {
    const el = document.createElement('div');
    el.className = 'active-spell';
    el.dataset.spellId = spell.spellId;

    const iconSrc = spell.iconName
      ? `https://cor-forum.de/regnum/RegnumNostalgia/items/${spell.iconName}`
      : '';

    const pct = spell.duration > 0 ? ((spell.duration - spell.remaining) / spell.duration) * 100 : 0;

    // Build description
    const parts = [];
    if (spell.healPerTick) parts.push(`+${spell.healPerTick} HP/s`);
    if (spell.manaPerTick) parts.push(`+${spell.manaPerTick} MP/s`);
    const desc = parts.join(', ');
    const name = SPELL_NAMES[spell.spellKey] || spell.spellKey;

    el.innerHTML = `
      ${iconSrc ? `<img src="${iconSrc}" alt="${name}" draggable="false">` : ''}
      <div class="spell-cooldown-overlay" style="height:${pct}%"></div>
      <div class="spell-timer">${spell.remaining}s</div>
      <div class="spell-tooltip">${name}${desc ? ' — ' + desc : ''}</div>
    `;

    container.appendChild(el);
  }
}

/**
 * Update just the timer text and overlay without full re-render.
 */
function updateTimers() {
  const container = document.getElementById('active-spells-container');
  if (!container) return;

  for (const spell of activeSpells) {
    const el = container.querySelector(`[data-spell-id="${spell.spellId}"]`);
    if (!el) continue;

    const timerEl = el.querySelector('.spell-timer');
    if (timerEl) timerEl.textContent = `${Math.max(0, spell.remaining)}s`;

    const overlayEl = el.querySelector('.spell-cooldown-overlay');
    if (overlayEl) {
      const pct = spell.duration > 0 ? ((spell.duration - spell.remaining) / spell.duration) * 100 : 0;
      overlayEl.style.height = `${pct}%`;
    }
  }
}

/**
 * Local tick — decrements remaining each second for smooth countdown.
 */
function startLocalTick() {
  if (localTickInterval) return;
  localTickInterval = setInterval(() => {
    let changed = false;
    activeSpells = activeSpells.filter(spell => {
      spell.remaining = Math.max(0, spell.remaining - 1);
      changed = true;
      if (spell.remaining <= 0) return false;
      return true;
    });
    if (changed) {
      if (activeSpells.length === 0) {
        stopLocalTick();
        renderActiveSpells();
      } else {
        updateTimers();
      }
    }
  }, 1000);
}

function stopLocalTick() {
  if (localTickInterval) {
    clearInterval(localTickInterval);
    localTickInterval = null;
  }
}

/**
 * Initialize spell UI and socket listeners. Call once after socket is available.
 */
export function initSpellsUI() {
  // Request active spells on connect
  const fetchSpells = () => {
    const socket = window.getSocket ? window.getSocket() : window.socket;
    if (!socket || !socket.connected) return;

    socket.emit('spell:active', {}, (resp) => {
      if (resp && resp.success && Array.isArray(resp.spells)) {
        activeSpells = resp.spells;
        renderActiveSpells();
        if (activeSpells.length > 0) startLocalTick();
        else stopLocalTick();
      }
    });
  };

  // Listen for spell events (guard against duplicate listeners)
  let listenersAttached = false;
  const setupListeners = (socket) => {
    if (listenersAttached) return;
    listenersAttached = true;

    socket.on('spell:started', (spell) => {
      // Remove any existing spell with same key to prevent duplicates
      activeSpells = activeSpells.filter(s => s.spellKey !== spell.spellKey);
      activeSpells.push(spell);
      renderActiveSpells();
      startLocalTick();
    });

    socket.on('spell:update', (data) => {
      if (data.userId !== gameState.userId) return;
      activeSpells = data.activeSpells || [];
      renderActiveSpells();
      if (activeSpells.length > 0) startLocalTick();
      else stopLocalTick();
    });

    socket.on('spell:expired', (data) => {
      if (data.userId !== gameState.userId) return;
      activeSpells = activeSpells.filter(s => s.spellId !== data.spellId);
      renderActiveSpells();
      if (activeSpells.length === 0) stopLocalTick();
    });
  };

  // Try to set up immediately
  const socket = window.getSocket ? window.getSocket() : window.socket;
  if (socket) {
    setupListeners(socket);
    if (socket.connected) fetchSpells();
  }

  // Also listen for reconnections
  window.addEventListener('websocket:connected', () => {
    const s = window.getSocket ? window.getSocket() : window.socket;
    if (s) {
      setupListeners(s);
      fetchSpells();
    }
  });
}
