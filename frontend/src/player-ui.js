/**
 * Player HUD — info display, health/mana bars, coordinate tracking, HUD button handlers.
 */

import { gameState, subscribe } from './state.js';
import { getMap } from './map-state.js';
import { openWindow, closeWindow, saveWindowState, setHudPressed } from './windows.js';

// ── Reactive subscriptions — auto-update UI when state changes ──
subscribe(['health', 'maxHealth', 'mana', 'maxMana'], () => updatePlayerStats());
subscribe(['username', 'realm', 'level'], () => showPlayerInfo());

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
