/**
 * Redis Cache Keys & TTL Configuration
 *
 * Central registry of all cache key prefixes and TTL values.
 * Imported by all other cache domain modules.
 */
import type { CacheKeyMap, CacheTTLMap } from '../../types';

// ==============================
// Cache key prefixes / constants
// ==============================
const CACHE_KEYS: CacheKeyMap = {
  // Static (permanent cache)
  ITEM_BY_TEMPLATE: 'cache:item:tmpl:',       // + template_key  → full item row JSON
  ITEM_BY_ID: 'cache:item:id:',               // + item_id       → full item row JSON
  LEVEL_XP: 'cache:levels',                    // hash: level → xp

  // Semi-static (invalidate on change)
  TERRITORIES: 'cache:territories',             // JSON string of full territory list
  SUPERBOSSES: 'cache:superbosses',             // JSON string of superboss list
  SERVER_TIME: 'cache:server_time',             // JSON string of server_time row

  // Per-user
  USER_SETTINGS: 'cache:settings:',             // + user_id       → JSON
  USER_GM: 'cache:gm:',                         // + user_id       → "1" or missing
  USER_EQUIPMENT_IDS: 'cache:equip:ids:',       // + user_id       → JSON array of inv IDs
  USER_EQUIPMENT_STATS: 'cache:equip:stats:',   // + user_id       → JSON of aggregated stats

  // Online tracking
  ONLINE_PLAYERS: 'cache:online_players',       // sorted set: member=userId, score=timestamp
  PLAYER_INFO: 'cache:player:',                 // + user_id       → JSON {username,realm,x,y,level,health,max_health}

  // last_active buffering
  LAST_ACTIVE: 'cache:last_active',             // sorted set: member=userId, score=timestamp

  // Shoutbox
  SHOUTBOX_MESSAGES: 'cache:shoutbox:messages',  // list of JSON message objects (newest at head)
  SHOUTBOX_LAST_ID: 'cache:shoutbox:last_id',   // last polled entryID

  // Walker
  ACTIVE_WALKERS: 'cache:walkers:active',        // hash: walkerId → JSON walker state
  USER_WALKER: 'cache:walkers:user:',            // + user_id → walkerId (for quick lookup)
  WALK_SPEED: 'cache:walk_speed:',               // + user_id → total walk_speed value
};

const TTL: CacheTTLMap = {
  USER_SETTINGS: 300,    // 5 minutes
  USER_GM: 600,          // 10 minutes
  USER_EQUIPMENT: 60,    // 1 minute (invalidated on equip/unequip anyway)
  TERRITORIES: 30,       // 30 seconds (invalidated on capture/update)
  SUPERBOSSES: 10,       // 10 seconds (health regens every 1s)
  SERVER_TIME: 15,       // 15 seconds (updated every 10s)
  PLAYER_INFO: 10,       // 10 seconds
};

module.exports = { CACHE_KEYS, TTL };
