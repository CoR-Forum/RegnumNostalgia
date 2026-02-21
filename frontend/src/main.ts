/**
 * Regnum Nostalgia — Game Entry Point
 *
 * This module is loaded DYNAMICALLY by login.js after successful authentication.
 * It imports all game modules and exports loadGame() for the login flow to call.
 */

// ── Styles ──
import './styles/main.css';

// ── Zero-dependency modules (register globals) ──
import './state';          // gameState, API_BASE, REALM_COLORS
import './utils';          // escapeHtml, formatDurationSeconds
import './items';          // getItemName, getItemTypeLabel

// ── Core services ──
import './api';            // apiCall, emitOrApi → window.apiCall
import './server-time';    // updateServerTimeUI, fetchServerTime → window.updateServerTimeUI

// ── Map accessor (no DOM) ──
import './map-state';

// ── UI modules ──
import './tooltip';
import './windows';        // initWindows, openWindow, closeWindow → window.*
import './player-ui';      // showPlayerInfo, updatePlayerStats → window.updatePlayerStats
import './player';         // updatePlayerFromState, createPlayerMarker

// ── Marker modules ──
import './players';        // updateOtherPlayers
import './territories';    // updateTerritories
import './superbosses';    // updateSuperbosses
import './screenshots';    // loadAndDisplayScreenshots

// ── Inventory & equipment ──
import './inventory';      // displayInventory, initInventoryDropZone
import './equipment';      // displayEquipment

// ── Walking & context menu ──
import './walking';        // performWalkAtLatLng, enableClickToMove, buildGoHereIcon
import './context-menu';   // createMapContextMenu, showMapContextMenuAt, hideMapContextMenu

// ── Audio ──
import './audio';          // AudioManager → window.AudioManager

// ── Quickbar ──
import './quickbar';       // initQuickbar → bottom-bar quick-cast slots

// ── Socket client (registers all event handlers) ──
import './socket-client';  // initializeWebSocket, getSocket → window.*

// ── Game bootstrap ──
import { gameState } from './state';
import { bootstrap } from './init';

/**
 * Load and initialize the game.
 * Called by login.js after successful authentication.
 *
 * @param {object} sessionData - Auth data from login (sessionToken, userId, username, realm)
 * @param {(message: string, percent: number) => void} progressCallback - Loading screen update function
 */
export async function loadGame(sessionData, progressCallback) {
  const progress = progressCallback || (() => {});

  // Transfer session data to gameState
  if (sessionData) {
    if (sessionData.sessionToken) gameState.sessionToken = sessionData.sessionToken;
    if (sessionData.userId) gameState.userId = sessionData.userId;
    if (sessionData.username) gameState.username = sessionData.username;
    if (sessionData.realm) gameState.realm = sessionData.realm;
  }

  // Mark body as authenticated so shoutbox and other UI partials can initialize
  document.body.classList.add('authenticated');

  progress('Initializing game...', 35);

  // Run game bootstrap (map, websocket, player data, UI)
  await bootstrap(progress);
}

