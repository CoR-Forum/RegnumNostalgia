/**
 * Regnum Nostalgia — Game Entry Point
 *
 * This module is loaded DYNAMICALLY by login.js after successful authentication.
 * It imports all game modules and exports loadGame() for the login flow to call.
 */

// ── Styles ──
import './styles/main.css';

// ── Zero-dependency modules (register globals) ──
import './state.js';          // gameState, API_BASE, REALM_COLORS
import './utils.js';          // escapeHtml, formatDurationSeconds
import './items.js';          // getItemName, getItemTypeLabel

// ── Core services ──
import './api.js';            // apiCall, emitOrApi → window.apiCall
import './server-time.js';    // updateServerTimeUI, fetchServerTime → window.updateServerTimeUI

// ── Map accessor (no DOM) ──
import './map-state.js';

// ── UI modules ──
import './tooltip.js';
import './windows.js';        // initWindows, openWindow, closeWindow → window.*
import './player-ui.js';      // showPlayerInfo, updatePlayerStats → window.updatePlayerStats
import './player.js';         // updatePlayerFromState, createPlayerMarker

// ── Marker modules ──
import './players.js';        // updateOtherPlayers
import './territories.js';    // updateTerritories
import './superbosses.js';    // updateSuperbosses
import './screenshots.js';    // loadAndDisplayScreenshots

// ── Inventory & equipment ──
import './inventory.js';      // displayInventory, initInventoryDropZone
import './equipment.js';      // displayEquipment

// ── Walking & context menu ──
import './walking.js';        // performWalkAtLatLng, enableClickToMove, buildGoHereIcon
import './context-menu.js';   // createMapContextMenu, showMapContextMenuAt, hideMapContextMenu

// ── Audio ──
import './audio.js';          // AudioManager → window.AudioManager

// ── Quickbar ──
import './quickbar.js';       // initQuickbar → bottom-bar quick-cast slots

// ── Socket client (registers all event handlers) ──
import './socket-client.js';  // initializeWebSocket, getSocket → window.*

// ── Game bootstrap ──
import { gameState } from './state.js';
import { bootstrap } from './init.js';

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

  progress('Initializing game...', 35);

  // Run game bootstrap (map, websocket, player data, UI)
  await bootstrap(progress);
}

