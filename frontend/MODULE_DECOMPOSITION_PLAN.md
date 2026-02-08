# index.html Inline JavaScript — Module Decomposition Plan

## File Overview

The main game `<script>` block runs from **line 341 to line 3415** (~3075 lines of JavaScript). Six smaller script blocks surround it. This document provides a complete function inventory, global state map, cross-reference analysis, and proposed ES module groupings.

---

## 1. Smaller Script Blocks (outside main block)

| Lines | Description | Recommendation |
|---|---|---|
| **37–63** | `window.loadLoginForm()` — fetches `login.html`, injects nodes/scripts | Absorb into a `loaders.js` module or keep inline (runs before any module) |
| **120–148** | IIFE — fetches `character.html`, injects into `#character-include` | Absorb into `loaders.js` |
| **150–176** | IIFE — fetches `settings.html`, injects into `#settings-include` | Absorb into `loaders.js` |
| **325–333** | IIFE — fetches `info-box.html`, injects into `#mini-info-include` | Absorb into `loaders.js` |
| **3417–3477** | IIFE — server time cycle: `getDaytimeLabel()`, `window.updateServerTimeUI()`, `fetchServerTime()` | → `server-time.js` module |
| **3482–3526** | IIFE — fetches `shoutbox.html`, injects nodes/scripts, initializes shoutbox window | Absorb into `loaders.js` |

All six share a common "fetch HTML partial → inject → execute scripts" pattern. They can be unified into a single `loaders.js` that exports a generic `loadPartial(url, containerId)` function plus the specific init calls.

---

## 2. Global Variables / Top-Level State (lines 555–630)

| Variable | Line | Type | Description |
|---|---|---|---|
| `API_BASE` | 555 | `const string` | `'/api'` |
| `REALM_COLORS` | 556 | `const object` | Realm → hex color map |
| `map` | 559 | `let (Leaflet Map)` | The Leaflet map instance (set in `probe.onload`) |
| `totalH` | 560 | `let number` | Scaled map height in Leaflet coords |
| `totalW` | 561 | `let number` | Scaled map width in Leaflet coords |
| `territoryIcons` | 562 | `let object` | Icon definitions from `markers.json` |
| `storedToken` | 564–576 | `let` | Sanitized session token from localStorage |
| `window.gameState` | 592–622 | `object` | Central game state (position, health, markers, maps, etc.) |
| `gameState` | 625 | `const ref` | Local alias for `window.gameState` |
| `socket` | 679 | `let` | Socket.io instance |
| `reconnectAttempts` | 680 | `let number` | WebSocket reconnect counter |
| `MAX_RECONNECT_ATTEMPTS` | 681 | `const number` | 5 |
| `currentTileVersion` | 349 | `let string` | `'v1'` or `'v2'` from localStorage |
| `currentTooltip` | 2103 | `let` | Active tooltip DOM element |
| `pendingTooltipTimer` | 2104 | `let` | Pending tooltip timer ref |
| `lastMouseX` / `lastMouseY` | 2105–2106 | `let` | Last mouse position for tooltip |
| `tooltipKeepOpen` | 2107 | `let bool` | Whether tooltip is pinned |
| `__lastContextLatLng` | 2741 | `let` | Last right-click map position |
| `__mapContextMenuEl` | 2742 | `let` | Context menu DOM element |
| `__lastContextAllowed` | 2743 | `let` | Cached walk-permission result |
| `window.__windowTopZ` | 1731 | `number` | Z-index counter for window stacking |

### Globals exposed on `window`:
- `window.gameState`
- `window.apiCall`
- `window.socket` (set/cleared dynamically)
- `window.initializeWebSocket`
- `window.getSocket`
- `window.initGame`
- `window.AudioManager`
- `window.updateServerTimeUI` (set in time script block, line 3435)
- `window.loadLoginForm` (set in loader script, line 40)
- `window.__windowTopZ`

---

## 3. Complete Function Inventory

### 3A. Map Initialization (inside `probe.onload`, lines 358–553)

| Function | Lines | Description |
|---|---|---|
| `tileUrl(r, c)` | 351 | Returns URL for a tile image |
| `probe.onload` (handler) | 358–553 | Main map setup: creates Leaflet map, loads tiles, markers, sets up coordinate readout |
| `addRasterMarker(x, y, opts)` | 401–404 | Adds a Leaflet marker using raster coords |
| `positionsToLatLngs(positions)` | 407–415 | Converts `[x,y]` or `{x,y}` arrays to Leaflet LatLngs |
| `loadTiles()` | 434–465 | Clears and re-adds tile image overlays |
| `toLatLng(p)` (inside markers fetch) | 492 | Converts `[x,y]` to Leaflet LatLng for marker loading |
| `probe.onerror` (handler) | 549–552 | Shows error message when probe tile fails to load |

### 3B. API & Networking (lines 626–676)

| Function | Lines | Description |
|---|---|---|
| `getRealmColor(realm)` | 627–630 | Returns hex color for a realm name |
| `buildGoHereIcon()` | 632–638 | Creates a gold circle Leaflet divIcon for walk destination |
| `apiCall(endpoint, options)` | 641–675 | Generic HTTP API helper with auth header injection |
| `emitOrApi(eventName, payload, fallbackPath, fallbackForm)` | 683–700 | WebSocket emit with HTTP fallback |

### 3C. WebSocket / Socket.io (lines 702–1413)

| Function | Lines | Description |
|---|---|---|
| `initializeWebSocket()` | 702–1413 | Master WebSocket setup function. Connects, registers ALL socket event handlers |

#### Socket event handlers registered inside `initializeWebSocket()`:
| Event | Lines | What it does |
|---|---|---|
| `connect` | 730–735 | Resets reconnect counter, dispatches `websocket:connected` |
| `disconnect` | 737–743 | Logs disconnection |
| `connect_error` | 745–752 | Reconnect logic, page reload on max attempts |
| `error` | 754–758 | Logs errors to game log |
| `player:state` | 761–763 | Calls `updatePlayerFromState(data)` |
| `player:health` | 765–790 | Updates health/mana in `gameState`, calls `updatePlayerStats()` |
| `players:online` | 792–796 | Calls `updateOtherPlayers(data.players)` |
| `players:position` | 798–820 | Updates own + other player marker positions |
| `player:connected` | 822–824 | Logs |
| `player:disconnected` | 826–834 | Removes disconnected player marker |
| `walker:step` | 837–864 | Updates position during walking, handles path updates |
| `walker:completed` | 866–875 | Clears walk UI, calls `clearAllCollectingMarks()` |
| `move:started` | 877–897 | Shows destination marker and walk path |
| `walker:restore` | 899–921 | Restores walk state after page reload |
| `territories:list` | 924–928 | Calls `updateTerritories()` |
| `territories:update` | 930–939 | Calls `updateTerritories()` or refreshes via API |
| `territories:capture` | 941–952 | Shows capture notifications |
| `superbosses:list` | 955–959 | Calls `updateSuperbosses()` |
| `superbosses:health` | 961–965 | Calls `updateSuperbosses()` |
| `time:current` | 968–977 | Calls `updateServerTimeUI()` |
| `paths:list` | 980–989 | Stores paths data, conditionally renders |
| `regions:list` | 991–995 | Stores regions data, conditionally renders |
| `spawned-items:list` | 998–1019 | Clears & recreates collectable markers |
| `collectable:spawned` | 1021–1027 | Creates new collectable marker |
| `collectable:collecting` | 1029–1040 | Marks item with orange border |
| `collectable:collected` | 1050–1068 | Removes marker |
| `collectable:failed` | 1070–1075 | Removes collecting state |
| `inventory:item-added` | 1077–1095 | Refreshes inventory window if open |
| `inventory:refresh` | 1097–1112 | Refreshes inventory window if open |
| `audio:play` | 1371–1378 | Plays music/sfx via AudioManager |
| `audio:stop` | 1380–1383 | Stops music |
| `time:update` | 1385–1394 | Calls `updateServerTimeUI()` |
| `shoutbox:message` | 1397–1401 | Delegates to `window.onShoutboxMessage` |
| `log:message` | 1404–1408 | Delegates to `window.onLogMessage` |

#### Helper functions defined INSIDE `initializeWebSocket()`:
| Function | Lines | Description |
|---|---|---|
| `clearAllCollectingMarks()` | 1115–1119 | Clears orange borders from all collectable markers |
| `updateCollectableMarker(spawnId, isCollecting)` | 1122–1136 | Sets/removes orange border on a collectable marker |
| `escapeHtml(str)` | 1139–1143 | Simple HTML entity escaper |
| `createCollectableMarker(item)` | 1146–1250 | Creates a Leaflet marker for a collectable item with icon, tooltip, click-to-collect handler |
| `showNotification(message, type)` | 1253–1255 | Disabled stub |
| Audio IIFE (anonymous) | 1258–1383 | Audio manager: `tryPlayMusic`, `playMusic`, `stopMusic`, `playSfx`, `resumePendingMusic`, plus `window.AudioManager` |

### 3D. Player State Management (lines 1415–1466)

| Function | Lines | Description |
|---|---|---|
| `updatePlayerFromState(data)` | 1415–1451 | Syncs all `gameState` fields from a server state object; updates marker position |
| `formatDurationSeconds(s)` | 1458–1466 | Formats seconds into `Xh Ym Zs` string |

### 3E. UI / HUD Button Handlers (lines 1470–1540)

| Function/Handler | Lines | Description |
|---|---|---|
| Inventory button click handler | 1472–1477 | Toggles inventory window |
| `setHudPressed(action, pressed)` | 1480–1487 | Adds/removes `.pressed` CSS class on HUD buttons |
| Delegated HUD click handler | 1490–1528 | Handles all `.ui-hud-btn` clicks (inventory, character, etc.) |
| Character button click handler | 1531–1540 | Toggles character window |

### 3F. Window Management (lines 1543–1782)

| Function | Lines | Description |
|---|---|---|
| `setTranslate(xPos, yPos, el)` | 1543–1546 | Sets CSS transform translate3d on element |
| `_getWindowsState()` | 1549–1553 | Reads persisted window states from localStorage |
| `_saveWindowsState(state)` | 1554–1556 | Saves window states to localStorage |
| `saveWindowState(id, patch)` | 1557–1562 | Saves a partial window state (position, open/closed) |
| `getWindowState(id)` | 1563–1566 | Gets saved state for a window |
| `tryRestoreOpen(id, saved)` | 1569–1600 | Retries opening a window until its module is loaded |
| `makeDraggable(winEl, handleEl)` | 1602–1676 | Makes a window draggable: mousedown/move/up handlers, viewport clamping |
| `initWindow({id, headerId, closeId, onClose, draggable})` | 1678–1756 | Full window initialization: restore position, drag, close button, z-index stacking |
| `initWindows()` | 1758–1763 | Initializes inventory, character, and mini-info windows |

### 3G. Tile Version Switcher (lines 1767–1776)

| Handler | Lines | Description |
|---|---|---|
| Tile version button click handler | 1767–1776 | Toggles between v1/v2 tiles (button may be absent) |

### 3H. Logout Handler (line 1779–1793)

| Handler | Lines | Description |
|---|---|---|
| Logout button click | 1779–1793 | Clears session, stops intervals, reloads page |

### 3I. Generic open/close Window Helpers (lines 1799–1930)

| Function | Lines | Description |
|---|---|---|
| `_normalizeWindowId(id)` | 1799–1804 | Accepts shorthand like `'inventory'` → `'inventory-window'` |
| `openWindow(id)` | 1806–1858 | Opens any window; has inline inventory and character initialization logic |
| `closeWindow(id)` | 1920–1933 | Closes any window, persists state |

### 3J. Inventory Display (lines 1937–2099)

| Function | Lines | Description |
|---|---|---|
| `displayInventory(items)` | 1937–2082 | Renders inventory items list: icons, drag/drop, tooltips, right-click equip/use |
| IIFE: inventory drop handler | 2085–2099 | Makes `#inventory-items` accept drops from equipment slots (unequip) |

### 3K. Tooltip System (lines 2103–2289)

| Function | Lines | Description |
|---|---|---|
| `positionTooltip(tooltip, mouseX, mouseY)` | 2109–2130 | Positions tooltip near cursor, clamped to viewport |
| `showTooltip(event, item)` | 2132–2259 | Creates tooltip with 200ms delay, fetches item details from server |
| `moveTooltip(event)` | 2261–2265 | Re-positions tooltip on mouse move |
| `hideTooltip()` | 2267–2277 | Removes tooltip, clears timers |

### 3L. Equipment System (lines 2280–2424)

| Function | Lines | Description |
|---|---|---|
| `getEquipIconSrc(item)` | 2281–2284 | Returns icon URL for equipment item |
| `getItemTypeLabel(item)` | 2287–2306 | Returns friendly label for item type + slot |
| `getItemName(item)` | 2309–2312 | Normalizes item display name |
| `displayEquipment(equipment)` | 2314–2424 | Renders equipment slots: icons, drag/drop, tooltips, right-click unequip |

### 3M. Player Info Display (lines 2432–2489)

| Function | Lines | Description |
|---|---|---|
| `showPlayerInfo()` | 2432–2443 | Updates username, realm badge, level in HUD overlay |
| `updatePlayerStats()` | 2445–2473 | Updates health/mana bars with percentages and UI images |
| `updatePlayerCoords(x, y)` | 2475–2489 | Updates position text; clears walk UI when destination reached |

### 3N. Game Initialization (lines 2493–2711)

| Function | Lines | Description |
|---|---|---|
| `initGame()` | 2493–2710 | Master game init: requests player state via socket, validates session via HTTP, reveals UI, creates player marker, enables click-to-move, initializes WebSocket |

### 3O. Player Marker (lines 2713–2738)

| Function | Lines | Description |
|---|---|---|
| `createPlayerMarker(x, y)` | 2713–2738 | Creates/updates the player's circle marker on the map |

### 3P. Context Menu (lines 2741–2845)

| Function | Lines | Description |
|---|---|---|
| `createMapContextMenu()` | 2746–2842 | Creates context menu DOM: Walk Here, Copy Coords, Screenshots, Region Editor |
| `showMapContextMenuAt(containerPoint, latlng)` | 2844–2882 | Positions and shows context menu, async walk permission check |
| `hideMapContextMenu()` | 2884–2888 | Hides context menu |

### 3Q. Walking / Click-to-Move (lines 2893–2976)

| Function | Lines | Description |
|---|---|---|
| `performWalkAtLatLng(latlng)` | 2893–2928 | Sends `move:request` via WebSocket |
| `enableClickToMove()` | 2932–2976 | Registers map click/contextmenu handlers for walking |

### 3R. Other Players (lines 2980–3078)

| Function | Lines | Description |
|---|---|---|
| `updateOtherPlayers(players)` | 2980–3078 | Creates/updates/removes markers for other online players |

### 3S. Territories (lines 3082–3196)

| Function | Lines | Description |
|---|---|---|
| `updateTerritories(territories)` | 3082–3196 | Creates/updates/removes territory markers with health bars |

### 3T. Superbosses (lines 3200–3269)

| Function | Lines | Description |
|---|---|---|
| `updateSuperbosses(bosses)` | 3200–3269 | Creates/updates/removes superboss markers with health bars |

### 3U. Screenshots (lines 3272–3330)

| Function | Lines | Description |
|---|---|---|
| `loadAndDisplayScreenshots()` | 3272–3289 | Fetches screenshots from API and calls `displayScreenshotMarkers()` |
| `displayScreenshotMarkers(screenshots)` | 3291–3330 | Creates tiny dot markers with screenshot tooltips |

### 3V. Boot Sequence (lines 3333–3415)

| Function | Lines | Description |
|---|---|---|
| `initWindows()` call | 3333 | Initializes draggable windows on page load |
| `checkAutoLogin()` | 3335–3408 | Auto-login flow: loads login.html if needed, attempts `initGame()`, handles fallback |

---

## 4. Cross-Reference Matrix

### Functions → Globals they READ:
| Function | Reads |
|---|---|
| `apiCall` | `gameState.sessionToken`, `API_BASE` |
| `emitOrApi` | `socket` |
| `initializeWebSocket` | `gameState`, `socket`, `map`, `totalH`, `totalW` |
| `updatePlayerFromState` | `gameState`, `totalH` |
| `createPlayerMarker` | `gameState`, `map`, `totalH`, `totalW` |
| `updateOtherPlayers` | `gameState`, `map`, `totalH` |
| `updateTerritories` | `gameState`, `map`, `totalH` |
| `updateSuperbosses` | `gameState`, `map`, `totalH` |
| `displayInventory` | `gameState` (via `socket`), `currentTooltip`, `tooltipKeepOpen` |
| `displayEquipment` | `gameState` (via `socket`), `currentTooltip` |
| `showTooltip` | `currentTooltip`, `pendingTooltipTimer`, `lastMouseX/Y`, `tooltipKeepOpen` |
| `positionTooltip` | (pure DOM) |
| `moveTooltip` | `currentTooltip`, `lastMouseX/Y` |
| `hideTooltip` | `currentTooltip`, `pendingTooltipTimer` |
| `openWindow` | `gameState`, `socket` |
| `closeWindow` | (window id lookup) |
| `initGame` | `gameState`, `socket`, `map`, `totalH` |
| `performWalkAtLatLng` | `gameState`, `totalH`, `socket` |
| `enableClickToMove` | `gameState`, `map` |
| `createCollectableMarker` | `gameState`, `map`, `totalH`, `totalW`, `socket` |
| `createMapContextMenu` | `__lastContextLatLng`, `__mapContextMenuEl`, `totalH` |
| `showMapContextMenuAt` | `__mapContextMenuEl`, `map` |
| `checkAutoLogin` | `gameState` |
| `showPlayerInfo` | `gameState` |
| `updatePlayerStats` | `gameState` |
| `updatePlayerCoords` | `gameState`, `map` |
| `getRealmColor` | `REALM_COLORS` |

### Functions → Functions they CALL:
| Caller | Calls |
|---|---|
| `initializeWebSocket` | `updatePlayerFromState`, `updateOtherPlayers`, `updateTerritories`, `updateSuperbosses`, `createCollectableMarker`, `clearAllCollectingMarks`, `updateCollectableMarker`, `escapeHtml`, `showNotification`, `updatePlayerCoords`, `window.updateServerTimeUI`, `window.onShoutboxMessage`, `window.onLogMessage`, `window.updatePlayerStats`, `window.buildPath.*`, `window.addLogMessage` |
| `initGame` | `apiCall`, `hideModal` (from login.html), `showPlayerInfo`, `updatePlayerStats`, `createPlayerMarker`, `enableClickToMove`, `initializeWebSocket`, `loadAndRenderPaths` (from build-path.js), `updatePlayerCoords`, `updateCharacterStats` (from character.html) |
| `openWindow` | `saveWindowState`, `setHudPressed`, `displayEquipment`, `displayInventory`, `updateCharacterStats`, `emitOrApi` |
| `closeWindow` | `saveWindowState`, `setHudPressed` |
| `displayInventory` | `getItemName`, `showTooltip`, `hideTooltip`, `moveTooltip`, `emitOrApi`, `openWindow` |
| `displayEquipment` | `getEquipIconSrc`, `getItemName`, `getItemTypeLabel`, `showTooltip`, `moveTooltip`, `hideTooltip`, `emitOrApi`, `openWindow` |
| `showTooltip` | `hideTooltip`, `positionTooltip`, `getItemName`, `getItemTypeLabel` |
| `createCollectableMarker` | `escapeHtml`, `buildGoHereIcon` (indirectly via socket handler) |
| `enableClickToMove` | `hideMapContextMenu`, `performWalkAtLatLng`, `showMapContextMenuAt`, `isLatLngWalkAllowedAsync` (from regions.js) |
| `performWalkAtLatLng` | `isLatLngWalkAllowedAsync` (from regions.js), `window.addLogMessage` |
| `createMapContextMenu` | `hideMapContextMenu`, `performWalkAtLatLng`, `isLatLngWalkAllowedAsync` |
| `updatePlayerFromState` | `showPlayerInfo`, `updateCharacterStats`, `updatePlayerStats`, `updatePlayerCoords` |
| `checkAutoLogin` | `window.loadLoginForm`, `initGame` |
| `initWindows` | `initWindow`, `closeWindow` |
| `initWindow` | `getWindowState`, `saveWindowState`, `makeDraggable`, `tryRestoreOpen`, `setHudPressed` |
| `createPlayerMarker` | `getRealmColor`, `escapeHtml` |
| `updateOtherPlayers` | `getRealmColor`, `escapeHtml` |

---

## 5. External Dependencies (from other files)

| External | Defined in | Used by (in index.html) |
|---|---|---|
| `isLatLngWalkAllowedAsync` | `regions.js` (exposed on `window`) | `performWalkAtLatLng`, `enableClickToMove`, `createMapContextMenu` |
| `initRegionDisplay` | `regions.js` | `probe.onload` |
| `loadAndRenderPaths` | `build-path.js` (exposed on `window`) | `initGame`, socket handler |
| `loadAndRenderRegions` | `regions.js` (exposed on `window`) | `initGame`, socket handler |
| `updateCharacterStats` | `character.html` (global) | `updatePlayerFromState`, `openWindow('character')` |
| `hideModal` | `login.html` (on `window`) | `initGame` |
| `showRealmSelection` | `login.html` (on `window`) | `initGame` |
| `window.buildPath.*` | `build-path.js` | socket handlers, `enableClickToMove` |
| `window.screenshotManager` | `screenshotManager.js` | `createMapContextMenu`, `displayScreenshotMarkers` |
| `window.addLogMessage` | `log handler` (loaded externally) | many functions |
| `window.onShoutboxMessage` | `shoutbox.html` | socket handler |
| `window.onLogMessage` | loaded externally | socket handler |

---

## 6. Proposed Module Groupings

### Module 1: `src/state.js` — Game State & Constants

**What goes in:**
- `API_BASE` constant
- `REALM_COLORS` constant
- `gameState` object creation and initialization
- `storedToken` sanitization logic
- `getRealmColor(realm)` (line 627)

**Exports:**
```js
export { API_BASE, REALM_COLORS, gameState, getRealmColor }
```

**Imports:** none

**Globals needed:** `localStorage`

**Notes:** This is the foundational module with zero dependencies. All other modules import from it.

---

### Module 2: `src/api.js` — API & Network Helpers

**What goes in:**
- `apiCall(endpoint, options)` (line 641)
- `emitOrApi(eventName, payload, fallbackPath, fallbackForm)` (line 683)

**Exports:**
```js
export { apiCall, emitOrApi }
```

**Imports:**
```js
import { API_BASE, gameState } from './state.js'
import { getSocket } from './socket-client.js'
```

**Notes:** `emitOrApi` needs access to the socket instance. Use a getter pattern or import from socket module.

---

### Module 3: `src/socket-client.js` — WebSocket Connection & Event Handlers

**What goes in:**
- `socket` variable
- `reconnectAttempts`, `MAX_RECONNECT_ATTEMPTS`
- `initializeWebSocket()` (line 702)
- All socket event handler registrations
- `clearAllCollectingMarks()` (line 1115)
- `updateCollectableMarker(spawnId, isCollecting)` (line 1122)
- `createCollectableMarker(item)` (line 1146)
- `showNotification(message, type)` (line 1253) — disabled stub

**Exports:**
```js
export { initializeWebSocket, getSocket, createCollectableMarker, clearAllCollectingMarks, updateCollectableMarker }
```

**Imports:**
```js
import { gameState } from './state.js'
import { apiCall } from './api.js'
import { updatePlayerFromState } from './player.js'
import { updateOtherPlayers } from './players.js'
import { updateTerritories } from './territories.js'
import { updateSuperbosses } from './superbosses.js'
import { updatePlayerStats, updatePlayerCoords, showPlayerInfo } from './player-ui.js'
import { displayInventory } from './inventory.js'
import { escapeHtml } from './utils.js'
import { getMapState } from './map.js'  // for map, totalH, totalW
```

**Globals needed:** `window.updateServerTimeUI`, `window.buildPath`, `window.onShoutboxMessage`, `window.onLogMessage`, `window.addLogMessage`, `L` (Leaflet)

---

### Module 4: `src/audio.js` — Audio Manager

**What goes in:**
- Audio IIFE contents (lines 1258–1383): `tryPlayMusic`, `playMusic`, `stopMusic`, `playSfx`, `resumePendingMusic`, `window.AudioManager` setup

**Exports:**
```js
export { AudioManager, initAudio }
```

**Imports:**
```js
import { getSocket } from './socket-client.js'
```

**Notes:** Currently tightly coupled to socket (registers `audio:play` and `audio:stop` handlers). Could instead export an `initAudio(socket)` function.

---

### Module 5: `src/map.js` — Map Initialization & Tile Management

**What goes in:**
- `map`, `totalH`, `totalW`, `territoryIcons` variables
- `currentTileVersion` and tile globals
- `probe.onload` handler (map creation, tile loading, `addRasterMarker`, `positionsToLatLngs`, `loadTiles`, marker/feature loading from `markers.json`, coordinate readout)
- `probe.onerror` handler
- Tile version switcher handler (line 1767)

**Exports:**
```js
export { getMap, getTotalH, getTotalW, positionsToLatLngs, addRasterMarker, getMapState }
// getMapState returns { map, totalH, totalW, territoryIcons }
```

**Imports:**
```js
import { gameState } from './state.js'
import { createCollectableMarker } from './socket-client.js'
```

**Globals needed:** `L` (Leaflet), `window.initRegionDisplay` (from regions.js), `window.handleRegionMouseMove`

**Notes:** This is the most complex module due to the async `probe.onload` pattern. The map initialization should return a Promise that resolves when the map is ready. Other modules should `await` it.

---

### Module 6: `src/player.js` — Player State Sync

**What goes in:**
- `updatePlayerFromState(data)` (line 1415)
- `createPlayerMarker(x, y)` (line 2713)

**Exports:**
```js
export { updatePlayerFromState, createPlayerMarker }
```

**Imports:**
```js
import { gameState, getRealmColor } from './state.js'
import { getMapState } from './map.js'
import { showPlayerInfo, updatePlayerStats, updatePlayerCoords } from './player-ui.js'
import { updateCharacterStats } from './character.js'  // or window call
import { escapeHtml } from './utils.js'
```

---

### Module 7: `src/player-ui.js` — Player HUD Display

**What goes in:**
- `showPlayerInfo()` (line 2432)
- `updatePlayerStats()` (line 2445)
- `updatePlayerCoords(x, y)` (line 2475)
- `setHudPressed(action, pressed)` (line 1480)
- Delegated HUD click handler (line 1490)
- Inventory/Character button click handlers (lines 1472, 1531)

**Exports:**
```js
export { showPlayerInfo, updatePlayerStats, updatePlayerCoords, setHudPressed }
```

**Imports:**
```js
import { gameState } from './state.js'
import { getMapState } from './map.js'
import { openWindow, closeWindow, saveWindowState } from './windows.js'
```

---

### Module 8: `src/windows.js` — Window Management System

**What goes in:**
- `setTranslate()` (line 1543)
- `_getWindowsState()` / `_saveWindowsState()` (lines 1549–1556)
- `saveWindowState()` / `getWindowState()` (lines 1557–1566)
- `tryRestoreOpen()` (line 1569)
- `makeDraggable()` (line 1602)
- `initWindow()` (line 1678)
- `initWindows()` (line 1758)
- `_normalizeWindowId()` (line 1799)
- `openWindow()` (line 1806)
- `closeWindow()` (line 1920)
- `window.__windowTopZ` management

**Exports:**
```js
export { initWindows, initWindow, openWindow, closeWindow, saveWindowState, getWindowState, makeDraggable, setHudPressed }
```

**Imports:**
```js
import { gameState } from './state.js'
import { getSocket } from './socket-client.js'
import { displayEquipment } from './equipment.js'
import { displayInventory } from './inventory.js'
import { updateCharacterStats } from './character.js'  // or window call
import { setHudPressed } from './player-ui.js'
```

**Notes:** `openWindow` has heavy inline logic for inventory and character windows. Consider extracting that into the respective modules and having `openWindow` dispatch to registered open handlers.

---

### Module 9: `src/inventory.js` — Inventory Display & Interaction

**What goes in:**
- `displayInventory(items)` (line 1937)
- Inventory drop handler IIFE (line 2085)

**Exports:**
```js
export { displayInventory }
```

**Imports:**
```js
import { gameState } from './state.js'
import { emitOrApi } from './api.js'
import { getSocket } from './socket-client.js'
import { getItemName, getItemTypeLabel } from './items.js'
import { showTooltip, moveTooltip, hideTooltip } from './tooltip.js'
import { openWindow } from './windows.js'
```

---

### Module 10: `src/equipment.js` — Equipment Display & Interaction

**What goes in:**
- `getEquipIconSrc(item)` (line 2281)
- `displayEquipment(equipment)` (line 2314)

**Exports:**
```js
export { displayEquipment, getEquipIconSrc }
```

**Imports:**
```js
import { getSocket } from './socket-client.js'
import { emitOrApi } from './api.js'
import { getItemName, getItemTypeLabel } from './items.js'
import { showTooltip, moveTooltip, hideTooltip } from './tooltip.js'
import { openWindow } from './windows.js'
```

---

### Module 11: `src/items.js` — Item Utility Functions

**What goes in:**
- `getItemTypeLabel(item)` (line 2287)
- `getItemName(item)` (line 2309)

**Exports:**
```js
export { getItemTypeLabel, getItemName }
```

**Imports:** none

---

### Module 12: `src/tooltip.js` — Tooltip System

**What goes in:**
- `currentTooltip`, `pendingTooltipTimer`, `lastMouseX/Y`, `tooltipKeepOpen` state
- `positionTooltip()` (line 2109)
- `showTooltip()` (line 2132)
- `moveTooltip()` (line 2261)
- `hideTooltip()` (line 2267)

**Exports:**
```js
export { showTooltip, moveTooltip, hideTooltip, positionTooltip }
```

**Imports:**
```js
import { getSocket } from './socket-client.js'
import { getItemName, getItemTypeLabel } from './items.js'
```

---

### Module 13: `src/context-menu.js` — Map Context Menu

**What goes in:**
- `__lastContextLatLng`, `__mapContextMenuEl`, `__lastContextAllowed` state
- `createMapContextMenu()` (line 2746)
- `showMapContextMenuAt()` (line 2844)
- `hideMapContextMenu()` (line 2884)

**Exports:**
```js
export { createMapContextMenu, showMapContextMenuAt, hideMapContextMenu }
```

**Imports:**
```js
import { getMapState } from './map.js'
import { performWalkAtLatLng } from './walking.js'
import { isLatLngWalkAllowedAsync } from './regions.js'  // or window call
```

**Globals needed:** `window.buildPath`, `window.screenshotManager`, `window.addLogMessage`

---

### Module 14: `src/walking.js` — Click-to-Move / Walking System

**What goes in:**
- `performWalkAtLatLng(latlng)` (line 2893)
- `enableClickToMove()` (line 2932)
- `buildGoHereIcon()` (line 632)

**Exports:**
```js
export { performWalkAtLatLng, enableClickToMove, buildGoHereIcon }
```

**Imports:**
```js
import { gameState } from './state.js'
import { getSocket } from './socket-client.js'
import { getMapState } from './map.js'
import { hideMapContextMenu, showMapContextMenuAt } from './context-menu.js'
import { isLatLngWalkAllowedAsync } from './regions.js'  // or window call
```

**Globals needed:** `L` (Leaflet), `window.addLogMessage`, `window.buildPath`

---

### Module 15: `src/players.js` — Other Players Markers

**What goes in:**
- `updateOtherPlayers(players)` (line 2980)

**Exports:**
```js
export { updateOtherPlayers }
```

**Imports:**
```js
import { gameState, getRealmColor } from './state.js'
import { getMapState } from './map.js'
import { escapeHtml } from './utils.js'
```

---

### Module 16: `src/territories.js` — Territory Markers

**What goes in:**
- `updateTerritories(territories)` (line 3082)

**Exports:**
```js
export { updateTerritories }
```

**Imports:**
```js
import { gameState } from './state.js'
import { getMapState } from './map.js'
import { formatDurationSeconds } from './utils.js'
```

**Globals needed:** `L` (Leaflet)

---

### Module 17: `src/superbosses.js` — Superboss Markers

**What goes in:**
- `updateSuperbosses(bosses)` (line 3200)

**Exports:**
```js
export { updateSuperbosses }
```

**Imports:**
```js
import { gameState } from './state.js'
import { getMapState } from './map.js'
import { formatDurationSeconds } from './utils.js'
```

---

### Module 18: `src/screenshots.js` — Screenshot Markers

**What goes in:**
- `loadAndDisplayScreenshots()` (line 3272)
- `displayScreenshotMarkers(screenshots)` (line 3291)

**Exports:**
```js
export { loadAndDisplayScreenshots, displayScreenshotMarkers }
```

**Imports:**
```js
import { gameState } from './state.js'
import { getMapState } from './map.js'
```

**Globals needed:** `window.screenshotManager`

---

### Module 19: `src/utils.js` — Shared Utilities

**What goes in:**
- `escapeHtml(str)` (line 1139)
- `formatDurationSeconds(s)` (line 1458)

**Exports:**
```js
export { escapeHtml, formatDurationSeconds }
```

**Imports:** none

---

### Module 20: `src/server-time.js` — Server Time UI

**What goes in:**
- Server time cycle IIFE contents (lines 3417–3477): `getDaytimeLabel`, `updateServerTimeUI`, `fetchServerTime`

**Exports:**
```js
export { updateServerTimeUI, fetchServerTime }
```

**Imports:**
```js
import { gameState } from './state.js'
import { getSocket } from './socket-client.js'
```

---

### Module 21: `src/loaders.js` — HTML Partial Loaders

**What goes in:**
- `loadPartial(url, containerId)` — generic fetch+inject
- `loadLoginForm()` (line 40)
- Character window loader (line 120)
- Settings loader (line 150)
- Info-box loader (line 325)
- Shoutbox loader (line 3482)

**Exports:**
```js
export { loadPartial, loadLoginForm }
```

**Imports:**
```js
import { initWindows } from './windows.js'
```

---

### Module 22: `src/init.js` — Boot / Entry Point

**What goes in:**
- `initGame()` (line 2493)
- `checkAutoLogin()` (line 3335)
- Logout handler (line 1779)
- Top-level wiring (calling `initWindows()`, etc.)

**Exports:** none (entry point)

**Imports:**
```js
import { gameState } from './state.js'
import { apiCall } from './api.js'
import { initializeWebSocket, getSocket } from './socket-client.js'
import { showPlayerInfo, updatePlayerStats, updatePlayerCoords } from './player-ui.js'
import { createPlayerMarker } from './player.js'
import { enableClickToMove } from './walking.js'
import { initWindows } from './windows.js'
import { loadLoginForm } from './loaders.js'
import { initMap } from './map.js'
```

---

## 7. Dependency Graph (simplified)

```
state.js  ←─────────────────────────────────────────────┐
  │                                                      │
  ├── api.js ←── socket-client.js                        │
  │                 │                                    │
  │                 ├── audio.js                         │
  │                 │                                    │
  ├── map.js ◄──────┤                                    │
  │                 │                                    │
  ├── utils.js ◄────┤                                    │
  │                 │                                    │
  ├── items.js ◄── tooltip.js ◄── inventory.js           │
  │                    │           equipment.js           │
  │                    │                                  │
  ├── player.js ◄── player-ui.js                         │
  │                                                      │
  ├── players.js                                         │
  ├── territories.js                                     │
  ├── superbosses.js                                     │
  ├── screenshots.js                                     │
  │                                                      │
  ├── context-menu.js ◄── walking.js                     │
  │                                                      │
  ├── windows.js ───────────────────────────────────────┘
  │
  ├── server-time.js
  ├── loaders.js
  │
  └── init.js (entry point, imports everything)
```

---

## 8. Circular Dependency Risks

| Cycle | Resolution |
|---|---|
| `socket-client.js` ↔ `api.js` | `emitOrApi` needs socket; socket handlers call `apiCall`. Move `emitOrApi` into `socket-client.js` or pass socket as param. |
| `windows.js` ↔ `inventory.js` / `equipment.js` | `openWindow('inventory')` calls `displayInventory`; `displayInventory` calls `openWindow`. Use a registration pattern: modules register their open/close handlers with `windows.js`. |
| `socket-client.js` → many marker modules | Already one-directional (socket imports them), no cycle. |
| `player-ui.js` ↔ `windows.js` | `setHudPressed` used by both. Keep `setHudPressed` in `player-ui.js`; `windows.js` imports it. |

---

## 9. Migration Strategy

1. **Phase 1:** Extract zero-dependency modules first: `utils.js`, `items.js`, `state.js`
2. **Phase 2:** Extract `api.js`, `tooltip.js`, `server-time.js`
3. **Phase 3:** Extract marker modules: `players.js`, `territories.js`, `superbosses.js`, `screenshots.js`
4. **Phase 4:** Extract `windows.js`, `player-ui.js`, `player.js`
5. **Phase 5:** Extract `inventory.js`, `equipment.js` (complex due to window cross-refs)
6. **Phase 6:** Extract `walking.js`, `context-menu.js`
7. **Phase 7:** Extract `map.js` (most complex, async initialization)
8. **Phase 8:** Extract `socket-client.js` + `audio.js` (largest, most cross-refs)
9. **Phase 9:** Extract `loaders.js`, `init.js` — make `src/main.js` the entry point
10. **Phase 10:** Remove all `window.*` globals, replace with proper imports

During migration, maintain backward compatibility by continuing to set `window.*` globals until all consumers are converted.
