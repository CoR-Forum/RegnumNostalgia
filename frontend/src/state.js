/**
 * Central game state, constants, reactive pub/sub, and realm utilities.
 */

export const API_BASE = '/api';

export const REALM_COLORS = {
  syrtis: '#22c55e',
  alsius: '#3b82f6',
  ignis: '#ef4444'
};

/**
 * Sanitize the stored session token from localStorage.
 * Treats literal strings 'null'/'undefined' or empty values as no token.
 */
function getSanitizedToken() {
  try {
    const raw = localStorage.getItem('sessionToken');
    if (raw && raw !== 'null' && raw !== 'undefined' && String(raw).trim() !== '') {
      return raw;
    }
  } catch (e) { /* ignore */ }
  return null;
}

// ── Reactive pub/sub ──

const _listeners = new Map();   // key → Set<callback>
let _batchDepth = 0;
const _batchedKeys = new Set();

/**
 * Subscribe to changes on one or more gameState keys.
 * @param {string|string[]} keys - property name(s) or '*' for all changes
 * @param {(value: any, oldValue: any, key: string) => void} callback
 * @returns {() => void} unsubscribe function
 */
export function subscribe(keys, callback) {
  const keyList = Array.isArray(keys) ? keys : [keys];
  for (const key of keyList) {
    if (!_listeners.has(key)) _listeners.set(key, new Set());
    _listeners.get(key).add(callback);
  }
  return () => {
    for (const key of keyList) {
      const set = _listeners.get(key);
      if (set) { set.delete(callback); if (set.size === 0) _listeners.delete(key); }
    }
  };
}

function _notify(key, value, oldValue) {
  const cbs = _listeners.get(key);
  if (cbs) cbs.forEach(cb => { try { cb(value, oldValue, key); } catch (e) { console.error('[state] listener error on', key, e); } });
  const wildcards = _listeners.get('*');
  if (wildcards) wildcards.forEach(cb => { try { cb(value, oldValue, key); } catch (e) {} });
}

/**
 * Set a single gameState property and notify subscribers.
 * No-ops if the value is strictly equal to the current value.
 */
export function setState(key, value) {
  const old = gameState[key];
  if (old === value) return;
  gameState[key] = value;
  if (_batchDepth > 0) { _batchedKeys.add(key); return; }
  _notify(key, value, old);
}

/**
 * Set multiple gameState properties. Notifications fire after all writes,
 * so subscribers only run once even if multiple watched keys change.
 */
export function batchUpdate(updates) {
  _batchDepth++;
  const snapshot = {};
  try {
    for (const [key, value] of Object.entries(updates)) {
      snapshot[key] = gameState[key]; // old value
      setState(key, value);
    }
  } finally {
    _batchDepth--;
    if (_batchDepth === 0) {
      const keys = [..._batchedKeys];
      _batchedKeys.clear();
      for (const key of keys) {
        _notify(key, gameState[key], snapshot[key]);
      }
    }
  }
}

/**
 * The central game state object.
 * Exposed on `window.gameState` for backward compatibility with non-module scripts.
 *
 * All properties are declared here with defaults to ensure a predictable shape.
 */
export const gameState = {
  // ── Auth / identity ──
  sessionToken: getSanitizedToken(),
  userId: null,
  username: null,
  realm: null,
  className: null,

  // ── Player stats (reactive — UI auto-updates) ──
  position: { x: 0, y: 0 },
  health: 1000,
  maxHealth: 1000,
  mana: 500,
  maxMana: 500,
  level: 1,
  xp: 0,
  xpToNext: 0,
  damage: 0,
  armor: 0,
  stats: { intelligence: 20, dexterity: 20, concentration: 20, strength: 20, constitution: 20 },
  damageTypes: {},
  armorTypes: {},
  totalEquipmentWeight: 0,

  // ── Marker / layer references ──
  playerMarker: null,
  otherPlayers: new Map(),
  territories: new Map(),
  superbosses: new Map(),
  collectables: new Map(),
  screenshots: new Map(),
  collectingSpawnIds: new Set(),
  walkDestinationMarker: null,
  walkPathPolyline: null,
  buildPathPolyline: null,
  pathsLayer: null,
  regionsLayer: null,

  // ── Data caches ──
  pendingCollectables: [],
  pathsData: [],
  regionsData: [],
  buildPathPoints: [],
  walkerPositions: null,
  walkerCurrentIndex: 0,

  // ── Flags ──
  walkingTarget: null,
  showRegions: false,
  showPaths: false,
  buildPathMode: false,
  buildMode: 'path',
};

// Expose on window for legacy non-module scripts (login.html, character.html, etc.)
window.gameState = gameState;

/** Returns the hex color for a realm name. */
export function getRealmColor(realm) {
  const key = (realm || '').toString().toLowerCase();
  return REALM_COLORS[key] || REALM_COLORS.syrtis;
}
