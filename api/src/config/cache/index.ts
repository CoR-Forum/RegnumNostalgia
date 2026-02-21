/**
 * Cache Layer — Barrel Export
 *
 * Re-exports all cache domain modules so existing imports
 * like `require('../config/cache')` continue to work unchanged.
 *
 * Domain modules:
 *   keys.ts        — CACHE_KEYS, TTL constants
 *   items.ts       — Item/level lookups, preloadStaticData
 *   territories.ts — Territory & superboss cache
 *   serverTime.ts  — Server time cache
 *   players.ts     — Online tracking, last_active, GM status
 *   settings.ts    — User settings cache
 *   walkers.ts     — Walker state & walk speed
 *   shoutbox.ts    — Chat message cache
 *   spells.ts      — Active spells & cooldowns
 */

const keys = require('./keys');
const items = require('./items');
const territories = require('./territories');
const serverTime = require('./serverTime');
const players = require('./players');
const settings = require('./settings');
const walkers = require('./walkers');
const shoutbox = require('./shoutbox');
const spells = require('./spells');

module.exports = {
  ...keys,
  ...items,
  ...territories,
  ...serverTime,
  ...players,
  ...settings,
  ...walkers,
  ...shoutbox,
  ...spells,
};
