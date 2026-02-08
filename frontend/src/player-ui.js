/**
 * Player HUD — info display, health/mana bars, coordinate tracking, HUD button handlers.
 */

import { gameState, subscribe } from './state.js';
import { getMap } from './map-state.js';
import { openWindow, closeWindow, saveWindowState, setHudPressed } from './windows.js';

// ── Reactive subscriptions — auto-update UI when state changes ──
subscribe(['health', 'maxHealth', 'mana', 'maxMana'], () => updatePlayerStats());
subscribe(['username', 'realm', 'level'], () => showPlayerInfo());
subscribe(['username', 'realm', 'className', 'level', 'xp', 'xpToNext', 'damage', 'armor', 'stats', 'damageTypes', 'armorTypes'], () => updateCharacterStats());

export function showPlayerInfo() {
  const username = gameState.username || '';
  const usernameEl = document.getElementById('player-username');
  const charNameEl = document.getElementById('char-name');
  const realmBadge = document.querySelector('#ui-character-status .realm-badge');
  if (usernameEl) usernameEl.textContent = username;
  if (charNameEl && !charNameEl.textContent.trim()) charNameEl.textContent = username || '-';
  if (realmBadge) realmBadge.className = `realm-badge ${gameState.realm}`;
  const lvlEl = document.getElementById('player-level');
  if (lvlEl) lvlEl.textContent = gameState.level || 1;
}

export function updatePlayerStats() {
  const healthPercent = (gameState.health / gameState.maxHealth) * 100;
  const healthFill = document.getElementById('player-health-fill');
  const healthText = document.getElementById('player-health-text');

  if (healthFill) {
    healthFill.style.width = `${healthPercent}%`;
    healthFill.className = 'territory-health-fill';
    healthFill.style.backgroundColor = 'transparent';
    healthFill.style.borderWidth = '0 2px 0 2px';
    healthFill.style.borderStyle = 'solid';
    healthFill.style.boxSizing = 'border-box';
    healthFill.style.borderImage = "url('https://cor-forum.de/regnum/RegnumNostalgia/ui/ui-bar-health.png') 0 2 0 2 fill / 0 2px 0 2px / 0 stretch";
  }
  if (healthText) healthText.textContent = `${gameState.health}/${gameState.maxHealth}`;

  const manaPercent = (gameState.mana / gameState.maxMana) * 100;
  const manaFill = document.getElementById('player-mana-fill');
  const manaText = document.getElementById('player-mana-text');

  if (manaFill) manaFill.style.width = `${manaPercent}%`;
  if (manaText) manaText.textContent = `${gameState.mana}/${gameState.maxMana}`;
}

// Expose globally for non-module consumers
window.updatePlayerStats = updatePlayerStats;

/**
 * Populate the character window DOM with current gameState values.
 */
export function updateCharacterStats() {
  try {
    const lvlEl = document.getElementById('char-level');
    if (lvlEl) lvlEl.textContent = gameState.level || 1;

    const nameEl = document.getElementById('char-name');
    if (nameEl) nameEl.textContent = gameState.username || '-';

    const realmEl = document.getElementById('char-realm');
    if (realmEl) {
      const r = gameState.realm ? (String(gameState.realm).charAt(0).toUpperCase() + String(gameState.realm).slice(1)) : '-';
      realmEl.textContent = r;
    }

    const classEl = document.getElementById('char-class');
    if (classEl) classEl.textContent = gameState.className || 'Unknown';

    // XP bar
    const xp = Number(gameState.xp || 0);
    const xpToNext = Number(gameState.xpToNext || 0);
    const pct = xpToNext > 0 ? Math.round((xp / (xp + xpToNext)) * 100) : 100;
    const fill = document.getElementById('char-xp-fill');
    if (fill) fill.style.width = pct + '%';
    const xpText = document.getElementById('char-xp-text');
    if (xpText) xpText.textContent = `${xp} / ${xp + xpToNext}`;

    // Attributes
    const s = gameState.stats || {};
    const setIf = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = String(val); };
    setIf('stat-int', s.intelligence || 20);
    setIf('stat-dex', s.dexterity || 20);
    setIf('stat-con', s.concentration || 20);
    setIf('stat-str', s.strength || 20);
    setIf('stat-const', s.constitution || 20);

    // Attack / Armor / secondary stats
    setIf('stat-attack', Number(gameState.damage || 0));
    setIf('stat-armor', Number(gameState.armor || 0));
    setIf('stat-hit', Number(gameState.hitChance || 0));
    setIf('stat-evasion', Number(gameState.evasion || 0));
    setIf('stat-block', Number(gameState.blockChance || 0));
    setIf('stat-weakness', Number(gameState.weakness || 0) + '%');

    // Damage / Armor type breakdowns
    const dt = gameState.damageTypes || {};
    const at = gameState.armorTypes || {};
    setIf('stat-damage-lightning', Number(dt.lightning || 0));
    setIf('stat-damage-fire', Number(dt.fire || 0));
    setIf('stat-damage-ice', Number(dt.ice || 0));
    setIf('stat-damage-pierce', Number(dt.pierce || 0));
    setIf('stat-damage-blunt', Number(dt.blunt || 0));
    setIf('stat-damage-slash', Number(dt.slash || 0));

    setIf('stat-armor-lightning', Number(at.lightning || 0));
    setIf('stat-armor-fire', Number(at.fire || 0));
    setIf('stat-armor-ice', Number(at.ice || 0));
    setIf('stat-armor-pierce', Number(at.pierce || 0));
    setIf('stat-armor-blunt', Number(at.blunt || 0));
    setIf('stat-armor-slash', Number(at.slash || 0));
  } catch (e) { /* character window may not be loaded yet */ }
}

export function updatePlayerCoords(x, y) {
  const el = document.getElementById('player-coords');
  if (el) el.textContent = `Position: ${x}, ${y}`;

  if (gameState.walkingTarget && gameState.walkingTarget.x === x && gameState.walkingTarget.y === y) {
    if (gameState.walkDestinationMarker) {
      try { getMap().removeLayer(gameState.walkDestinationMarker); } catch (e) {}
      gameState.walkDestinationMarker = null;
    }
    gameState.walkingTarget = null;
    try { if (window.buildPath && typeof window.buildPath.clearWalkerPath === 'function') window.buildPath.clearWalkerPath(); } catch (e) { console.debug('clear walk path failed', e); }
  }
}

// ── HUD button handlers (delegated) ──

export function initHudButtons() {
  // Legacy header inventory button
  const _inventoryBtn = document.getElementById('inventory-btn');
  if (_inventoryBtn) _inventoryBtn.addEventListener('click', () => {
    const inv = document.getElementById('inventory-window');
    if (inv && inv.style.display && inv.style.display !== 'none') closeWindow('inventory-window');
    else openWindow('inventory-window');
  });

  // Delegated handler for .ui-hud-btn clicks
  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('.ui-hud-btn');
    if (!btn) return;
    const action = String(btn.dataset.action || '').trim();
    if (!action) return;
    try {
      if (action === 'inventory') {
        const inv = document.getElementById('inventory-window');
        if (inv && inv.style.display && inv.style.display !== 'none') return closeWindow('inventory-window');
        return openWindow('inventory-window');
      }
      if (action === 'character') {
        const charWin = document.getElementById('character-window');
        if (charWin && charWin.style.display && charWin.style.display !== 'none') {
          setHudPressed('character', false);
          return closeWindow('character-window');
        }
        try { openWindow('character-window'); } catch (e) {}
        setHudPressed('character', true);
        try { saveWindowState('character-window', { open: true, display: 'flex' }); } catch (e) {}
        return;
      }
      const fnName = 'open' + action.charAt(0).toUpperCase() + action.slice(1);
      const fn = window[fnName];
      if (typeof fn === 'function') return fn();
      console.debug('No handler for HUD action', action);
    } catch (err) { console.error('HUD button action failed', err); }
  });

  // Legacy header character button
  const _characterBtn = document.getElementById('character-btn');
  if (_characterBtn) _characterBtn.addEventListener('click', () => {
    const charWin = document.getElementById('character-window');
    if (charWin && charWin.style.display && charWin.style.display !== 'none') {
      setHudPressed('character', false);
      closeWindow('character-window');
    } else {
      try { openWindow('character-window'); } catch (e) {}
      setHudPressed('character', true);
      try { saveWindowState('character-window', { open: true, display: 'flex' }); } catch (e) {}
    }
  });
}

// Re-export setHudPressed so it's accessible from this module too
export { setHudPressed } from './windows.js';
