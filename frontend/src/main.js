/**
 * Regnum Nostalgia — Frontend Entry Point
 *
 * This module is loaded via <script type="module"> in index.html.
 * It imports all decomposed ES modules and bootstraps the application.
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

// ── Map initialization + game bootstrap ──
import { bootstrap } from './init.js';

// ── Start the application ──
bootstrap();
