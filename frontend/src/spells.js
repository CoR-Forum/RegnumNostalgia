/**
 * Active Spells UI — shows active spell buffs to the left of the compass.
 * Listens for socket events: spell:started, spell:update, spell:expired.
 * Requests initial active spells on socket connect.
 * Also tracks spell cooldowns — shown as overlay on inventory items.
 */

import { gameState } from './state.js';

/** @type {Array<{spellId:number, spellKey:string, iconName:string, duration:number, remaining:number, healPerTick?:number, manaPerTick?:number, walkSpeed?:number, cooldown?:number}>} */
let activeSpells = [];

/** @type {Object<string, {remaining:number, total:number, iconName:string|null}>} */
let spellCooldowns = {};

/** Local timers to tick down the countdown without waiting for server */
let localTickInterval = null;

const SPELL_NAMES = {
  health_potion: 'Health Potion',
  mana_potion: 'Mana Potion',
  speed_potion: 'Speed Potion',
  damage_potion: 'Damage Potion'
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

  // Render active spells
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
    if (spell.damagePerTick) parts.push(`-${spell.damagePerTick} HP/s`);
    if (spell.walkSpeed) parts.push(`+${spell.walkSpeed} Speed`);
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

  // Update cooldown overlays on inventory items
  updateInventoryCooldowns();
}

/**
 * Update just the timer text and overlay without full re-render.
 */
function updateTimers() {
  const container = document.getElementById('active-spells-container');
  if (!container) return;

  // Update active spells
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

  // Update cooldown overlays on inventory items
  updateInventoryCooldowns();
}

/**
 * Local tick — decrements remaining each second for smooth countdown.
 * Also decrements spell cooldowns.
 */
function startLocalTick() {
  if (localTickInterval) return;
  localTickInterval = setInterval(() => {
    let changed = false;

    // Tick active spells
    activeSpells = activeSpells.filter(spell => {
      spell.remaining = Math.max(0, spell.remaining - 1);
      changed = true;
      if (spell.remaining <= 0) return false;
      return true;
    });

    // Tick cooldowns
    for (const [spellKey, cd] of Object.entries(spellCooldowns)) {
      cd.remaining = Math.max(0, cd.remaining - 1);
      changed = true;
      if (cd.remaining <= 0) {
        delete spellCooldowns[spellKey];
      }
    }

    if (changed) {
      const hasCooldowns = Object.keys(spellCooldowns).length > 0;
      if (activeSpells.length === 0 && !hasCooldowns) {
        stopLocalTick();
        renderActiveSpells();
        updateInventoryCooldowns();
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

        // Restore cooldowns from server
        if (Array.isArray(resp.cooldowns)) {
          spellCooldowns = {};
          for (const cd of resp.cooldowns) {
            spellCooldowns[cd.spellKey] = { remaining: cd.remaining, total: cd.total, iconName: cd.iconName };
          }
        }

        renderActiveSpells();
        const hasCooldowns = Object.keys(spellCooldowns).length > 0;
        if (activeSpells.length > 0 || hasCooldowns) startLocalTick();
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

      // Start tracking cooldown if spell has one
      if (spell.cooldown && spell.cooldown > 0) {
        spellCooldowns[spell.spellKey] = {
          remaining: spell.cooldown,
          total: spell.cooldown,
          iconName: spell.iconName
        };
      }

      renderActiveSpells();
      startLocalTick();
    });

    socket.on('spell:update', (data) => {
      if (data.userId !== gameState.userId) return;
      activeSpells = data.activeSpells || [];
      renderActiveSpells();
      const hasCooldowns = Object.keys(spellCooldowns).length > 0;
      if (activeSpells.length > 0 || hasCooldowns) startLocalTick();
      else stopLocalTick();
    });

    socket.on('spell:expired', (data) => {
      if (data.userId !== gameState.userId) return;
      activeSpells = activeSpells.filter(s => s.spellId !== data.spellId);
      renderActiveSpells();
      const hasCooldowns = Object.keys(spellCooldowns).length > 0;
      if (activeSpells.length === 0 && !hasCooldowns) stopLocalTick();
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

/**
 * Get the number of currently active spells matching a given spell key.
 */
export function getActiveSpellCount(spellKey) {
  return activeSpells.filter(s => s.spellKey === spellKey).length;
}

/**
 * Check if a spell is currently on cooldown.
 * @param {string} spellKey
 * @returns {boolean}
 */
export function isSpellOnCooldown(spellKey) {
  const cd = spellCooldowns[spellKey];
  return cd != null && cd.remaining > 0;
}

/**
 * Get cooldown remaining info for a spell.
 * @param {string} spellKey
 * @returns {{ remaining: number, total: number } | null}
 */
export function getSpellCooldownRemaining(spellKey) {
  const cd = spellCooldowns[spellKey];
  if (!cd || cd.remaining <= 0) return null;
  return { remaining: cd.remaining, total: cd.total };
}

/**
 * Update cooldown overlays on inventory items.
 * Looks for .inventory-item[data-spell-key] elements and adds/updates/removes cooldown overlays.
 */
function updateInventoryCooldowns() {
  const invContainer = document.getElementById('inventory-items');
  if (!invContainer) return;

  const items = invContainer.querySelectorAll('.inventory-item[data-spell-key]');
  for (const itemEl of items) {
    const spellKey = itemEl.dataset.spellKey;
    const cd = spellCooldowns[spellKey];
    const iconEl = itemEl.querySelector('.item-icon');
    if (!iconEl) continue;

    let overlay = iconEl.querySelector('.item-cd-overlay');

    if (cd && cd.remaining > 0) {
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'item-cd-overlay';
        overlay.innerHTML = '<span class="item-cd-timer"></span>';
        iconEl.appendChild(overlay);
      }
      const timerEl = overlay.querySelector('.item-cd-timer');
      if (timerEl) timerEl.textContent = `${cd.remaining}s`;
    } else {
      if (overlay) overlay.remove();
    }
  }
}
