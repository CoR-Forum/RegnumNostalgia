/**
 * Redis Cache Layer
 * 
 * Provides application-level caching for frequently queried data.
 * Uses the existing Redis connection from database.js.
 * 
 * Cache Strategy:
 * - Static data (items, levels): cached indefinitely, loaded once at startup
 * - Semi-static data (territories, superbosses, server_time): cached with invalidation on write
 * - Per-user data (settings, equipment, GM status): cached with short TTL, invalidated on write
 * - Online players: tracked via Redis sorted set (ZADD with timestamp scores)
 * - last_active: buffered in Redis, flushed to MariaDB periodically
 */
const { redis } = require('./database');
const logger = require('./logger');

// ==============================
// Cache key prefixes / constants
// ==============================
const CACHE_KEYS = {
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

const TTL = {
  USER_SETTINGS: 300,    // 5 minutes
  USER_GM: 600,          // 10 minutes
  USER_EQUIPMENT: 60,    // 1 minute (invalidated on equip/unequip anyway)
  TERRITORIES: 30,       // 30 seconds (invalidated on capture/update)
  SUPERBOSSES: 10,       // 10 seconds (health regens every 1s)
  SERVER_TIME: 15,       // 15 seconds (updated every 10s)
  PLAYER_INFO: 10,       // 10 seconds
};

// ==============================
// Static data: Items
// ==============================

/**
 * Get item by template_key. Checks Redis first, falls back to DB.
 */
async function getItemByTemplateKey(gameDb, templateKey) {
  const cacheKey = CACHE_KEYS.ITEM_BY_TEMPLATE + templateKey;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (e) { /* fall through to DB */ }

  const [rows] = await gameDb.query('SELECT * FROM items WHERE template_key = ?', [templateKey]);
  if (rows.length === 0) return null;

  const item = rows[0];
  try {
    await redis.set(cacheKey, JSON.stringify(item));
    // Also cache by ID
    await redis.set(CACHE_KEYS.ITEM_BY_ID + item.item_id, JSON.stringify(item));
  } catch (e) { logger.error('Redis set failed (item tmpl)', { error: e.message }); }

  return item;
}

/**
 * Get item by item_id. Checks Redis first, falls back to DB.
 */
async function getItemById(gameDb, itemId) {
  const cacheKey = CACHE_KEYS.ITEM_BY_ID + itemId;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (e) { /* fall through */ }

  const [rows] = await gameDb.query('SELECT * FROM items WHERE item_id = ?', [itemId]);
  if (rows.length === 0) return null;

  const item = rows[0];
  try {
    await redis.set(cacheKey, JSON.stringify(item));
    await redis.set(CACHE_KEYS.ITEM_BY_TEMPLATE + item.template_key, JSON.stringify(item));
  } catch (e) { logger.error('Redis set failed (item id)', { error: e.message }); }

  return item;
}

// ==============================
// Static data: Levels
// ==============================

/**
 * Get XP required for a specific level. Uses Redis hash for all levels.
 */
async function getLevelXp(gameDb, level) {
  try {
    const cached = await redis.hget(CACHE_KEYS.LEVEL_XP, String(level));
    if (cached !== null) return Number(cached);
  } catch (e) { /* fall through */ }

  // Load all levels at once into the hash
  const [rows] = await gameDb.query('SELECT level, xp FROM levels ORDER BY level');
  if (rows.length > 0) {
    const pipeline = redis.pipeline();
    for (const row of rows) {
      pipeline.hset(CACHE_KEYS.LEVEL_XP, String(row.level), String(row.xp));
    }
    try { await pipeline.exec(); } catch (e) { logger.error('Redis pipeline failed (levels)', { error: e.message }); }
  }

  const match = rows.find(r => r.level === level);
  return match ? Number(match.xp) : null;
}

// ==============================
// Semi-static: Territories
// ==============================

async function getCachedTerritories(gameDb) {
  try {
    const cached = await redis.get(CACHE_KEYS.TERRITORIES);
    if (cached) return JSON.parse(cached);
  } catch (e) { /* fall through */ }

  const [territories] = await gameDb.query(
    `SELECT territory_id, realm, name, type, health, max_health, x, y,
            owner_realm, contested, icon_name, icon_name_contested
     FROM territories ORDER BY territory_id`
  );

  try {
    await redis.set(CACHE_KEYS.TERRITORIES, JSON.stringify(territories), 'EX', TTL.TERRITORIES);
  } catch (e) { logger.error('Redis set failed (territories)', { error: e.message }); }

  return territories;
}

async function invalidateTerritories() {
  try { await redis.del(CACHE_KEYS.TERRITORIES); } catch (e) { /* ignore */ }
}

// ==============================
// Semi-static: Superbosses
// ==============================

async function getCachedSuperbosses(gameDb) {
  try {
    const cached = await redis.get(CACHE_KEYS.SUPERBOSSES);
    if (cached) return JSON.parse(cached);
  } catch (e) { /* fall through */ }

  const [superbosses] = await gameDb.query(
    `SELECT boss_id, name, icon_name, health, max_health, x, y
     FROM superbosses ORDER BY boss_id`
  );

  try {
    await redis.set(CACHE_KEYS.SUPERBOSSES, JSON.stringify(superbosses), 'EX', TTL.SUPERBOSSES);
  } catch (e) { logger.error('Redis set failed (superbosses)', { error: e.message }); }

  return superbosses;
}

async function invalidateSuperbosses() {
  try { await redis.del(CACHE_KEYS.SUPERBOSSES); } catch (e) { /* ignore */ }
}

// ==============================
// Semi-static: Server Time
// ==============================

async function getCachedServerTime(gameDb) {
  try {
    const cached = await redis.get(CACHE_KEYS.SERVER_TIME);
    if (cached) return JSON.parse(cached);
  } catch (e) { /* fall through */ }

  const [rows] = await gameDb.query('SELECT * FROM server_time WHERE id = 1');
  if (rows.length === 0) return null;

  const serverTime = rows[0];
  try {
    await redis.set(CACHE_KEYS.SERVER_TIME, JSON.stringify(serverTime), 'EX', TTL.SERVER_TIME);
  } catch (e) { logger.error('Redis set failed (server_time)', { error: e.message }); }

  return serverTime;
}

async function setCachedServerTime(data) {
  try {
    await redis.set(CACHE_KEYS.SERVER_TIME, JSON.stringify(data), 'EX', TTL.SERVER_TIME);
  } catch (e) { /* ignore */ }
}

async function invalidateServerTime() {
  try { await redis.del(CACHE_KEYS.SERVER_TIME); } catch (e) { /* ignore */ }
}

// ==============================
// Per-user: Settings
// ==============================

async function getCachedUserSettings(gameDb, userId) {
  const cacheKey = CACHE_KEYS.USER_SETTINGS + userId;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (e) { /* fall through */ }

  const [rows] = await gameDb.query(
    'SELECT music_enabled, music_volume, sounds_enabled, sound_volume, capture_sounds_enabled, capture_sounds_volume, collection_sounds_enabled, collection_sounds_volume, map_version FROM user_settings WHERE user_id = ?',
    [userId]
  );

  const settings = rows && rows.length > 0 ? {
    musicEnabled: rows[0].music_enabled === 1 ? 1 : 0,
    musicVolume: typeof rows[0].music_volume === 'number' ? rows[0].music_volume : parseFloat(rows[0].music_volume) || 0.6,
    soundsEnabled: rows[0].sounds_enabled === 1 ? 1 : 0,
    soundVolume: typeof rows[0].sound_volume === 'number' ? rows[0].sound_volume : parseFloat(rows[0].sound_volume) || 1.0,
    captureSoundsEnabled: rows[0].capture_sounds_enabled === 1 ? 1 : 0,
    captureSoundsVolume: typeof rows[0].capture_sounds_volume === 'number' ? rows[0].capture_sounds_volume : parseFloat(rows[0].capture_sounds_volume) || 1.0,
    collectionSoundsEnabled: rows[0].collection_sounds_enabled === 1 ? 1 : 0,
    collectionSoundsVolume: typeof rows[0].collection_sounds_volume === 'number' ? rows[0].collection_sounds_volume : parseFloat(rows[0].collection_sounds_volume) || 1.0,
    mapVersion: rows[0].map_version || 'v1'
  } : null;

  if (settings) {
    try {
      await redis.set(cacheKey, JSON.stringify(settings), 'EX', TTL.USER_SETTINGS);
    } catch (e) { /* ignore */ }
  }

  return settings;
}

async function invalidateUserSettings(userId) {
  try { await redis.del(CACHE_KEYS.USER_SETTINGS + userId); } catch (e) { /* ignore */ }
}

// ==============================
// Per-user: GM Status
// ==============================

async function getCachedGMStatus(forumDb, userId) {
  const cacheKey = CACHE_KEYS.USER_GM + userId;
  try {
    const cached = await redis.get(cacheKey);
    if (cached !== null) return cached === '1';
  } catch (e) { /* fall through */ }

  const [rows] = await forumDb.query(
    'SELECT groupID FROM wcf1_user_to_group WHERE userID = ? AND groupID = 32',
    [userId]
  );
  const isGm = rows.length > 0;

  try {
    await redis.set(cacheKey, isGm ? '1' : '0', 'EX', TTL.USER_GM);
  } catch (e) { /* ignore */ }

  return isGm;
}

// ==============================
// Online Players (Redis Sorted Set)
// ==============================

/**
 * Mark a player as online with their current info.
 * Uses a sorted set (score=timestamp) for efficient "who's online" queries.
 */
async function markPlayerOnline(userId, playerInfo) {
  const now = Math.floor(Date.now() / 1000);
  try {
    const pipeline = redis.pipeline();
    pipeline.zadd(CACHE_KEYS.ONLINE_PLAYERS, now, String(userId));
    pipeline.set(CACHE_KEYS.PLAYER_INFO + userId, JSON.stringify(playerInfo), 'EX', TTL.PLAYER_INFO);
    await pipeline.exec();
  } catch (e) { logger.error('Redis markPlayerOnline failed', { error: e.message }); }
}

/**
 * Remove a player from the online set.
 */
async function markPlayerOffline(userId) {
  try {
    const pipeline = redis.pipeline();
    pipeline.zrem(CACHE_KEYS.ONLINE_PLAYERS, String(userId));
    pipeline.del(CACHE_KEYS.PLAYER_INFO + userId);
    await pipeline.exec();
  } catch (e) { /* ignore */ }
}

/**
 * Update a player's position in cache.
 */
async function updatePlayerPosition(userId, x, y) {
  const now = Math.floor(Date.now() / 1000);
  try {
    // Update timestamp in sorted set
    await redis.zadd(CACHE_KEYS.ONLINE_PLAYERS, now, String(userId));

    // Update position in player info
    const infoKey = CACHE_KEYS.PLAYER_INFO + userId;
    const cached = await redis.get(infoKey);
    if (cached) {
      const info = JSON.parse(cached);
      info.x = x;
      info.y = y;
      await redis.set(infoKey, JSON.stringify(info), 'EX', TTL.PLAYER_INFO);
    }
  } catch (e) { /* ignore */ }
}

/**
 * Get all online players (active within threshold seconds).
 * Falls back to DB if Redis data is empty.
 */
async function getOnlinePlayers(gameDb, thresholdSeconds) {
  const cutoff = Math.floor(Date.now() / 1000) - thresholdSeconds;
  try {
    // Get user IDs active within threshold
    const userIds = await redis.zrangebyscore(CACHE_KEYS.ONLINE_PLAYERS, cutoff, '+inf');

    if (userIds.length > 0) {
      // Fetch player info from cache
      const pipeline = redis.pipeline();
      userIds.forEach(uid => pipeline.get(CACHE_KEYS.PLAYER_INFO + uid));
      const results = await pipeline.exec();

      const players = [];
      const missingIds = [];

      results.forEach(([err, data], idx) => {
        if (!err && data) {
          try { players.push(JSON.parse(data)); } catch (e) { missingIds.push(userIds[idx]); }
        } else {
          missingIds.push(userIds[idx]);
        }
      });

      // If some players are missing from cache, fetch from DB
      if (missingIds.length > 0) {
        const [dbPlayers] = await gameDb.query(
          `SELECT user_id, username, realm, x, y, level, health, max_health
           FROM players WHERE user_id IN (?)`,
          [missingIds.map(Number)]
        );

        for (const p of dbPlayers) {
          const info = {
            userId: p.user_id,
            username: p.username,
            realm: p.realm,
            x: p.x,
            y: p.y,
            level: p.level,
            health: p.health,
            maxHealth: p.max_health
          };
          players.push(info);
          // Cache for next time
          markPlayerOnline(p.user_id, info);
        }
      }

      return players;
    }
  } catch (e) {
    logger.error('Redis getOnlinePlayers failed, falling back to DB', { error: e.message });
  }

  // Fallback: query DB directly
  const [players] = await gameDb.query(
    `SELECT user_id, username, realm, x, y, level, health, max_health
     FROM players 
     WHERE last_active > DATE_SUB(NOW(), INTERVAL ? SECOND)
     AND realm IS NOT NULL`,
    [thresholdSeconds]
  );

  return players.map(p => ({
    userId: p.user_id,
    username: p.username,
    realm: p.realm,
    x: p.x,
    y: p.y,
    level: p.level,
    health: p.health,
    maxHealth: p.max_health
  }));
}

/**
 * Clean up expired entries from the online sorted set.
 */
async function cleanupOnlinePlayers(thresholdSeconds) {
  const cutoff = Math.floor(Date.now() / 1000) - thresholdSeconds;
  try {
    await redis.zremrangebyscore(CACHE_KEYS.ONLINE_PLAYERS, '-inf', cutoff);
  } catch (e) { /* ignore */ }
}

// ==============================
// last_active Buffering
// ==============================

/**
 * Buffer a last_active update in Redis instead of hitting DB immediately.
 */
async function bufferLastActive(userId) {
  const now = Math.floor(Date.now() / 1000);
  try {
    await redis.zadd(CACHE_KEYS.LAST_ACTIVE, now, String(userId));
  } catch (e) { /* ignore - non-critical */ }
}

/**
 * Flush buffered last_active timestamps to MariaDB.
 * Called periodically (e.g., every 5 seconds).
 */
async function flushLastActive(gameDb) {
  try {
    const entries = await redis.zrangebyscore(CACHE_KEYS.LAST_ACTIVE, '-inf', '+inf', 'WITHSCORES');
    if (entries.length === 0) return 0;

    // entries = [userId1, score1, userId2, score2, ...]
    const updates = [];
    for (let i = 0; i < entries.length; i += 2) {
      updates.push({ userId: Number(entries[i]), timestamp: Number(entries[i + 1]) });
    }

    if (updates.length === 0) return 0;

    // Batch update using CASE statement
    const userIds = updates.map(u => u.userId);
    const cases = updates.map(u => `WHEN ${u.userId} THEN ${u.timestamp}`).join(' ');
    
    await gameDb.query(
      `UPDATE players SET last_active = CASE user_id ${cases} END WHERE user_id IN (?)`,
      [userIds]
    );

    // Clear the buffer
    await redis.del(CACHE_KEYS.LAST_ACTIVE);

    return updates.length;
  } catch (e) {
    logger.error('Failed to flush last_active buffer', { error: e.message });
    return 0;
  }
}

// ==============================
// Walker state (active walkers in Redis)
// ==============================

/**
 * Store an active walker in Redis (called when createWalker inserts a DB row).
 * Also sets a user→walkerId mapping for quick user-based lookup.
 */
async function setActiveWalker(walkerId, walkerData) {
  try {
    const pipeline = redis.pipeline();
    pipeline.hset(CACHE_KEYS.ACTIVE_WALKERS, String(walkerId), JSON.stringify(walkerData));
    pipeline.set(CACHE_KEYS.USER_WALKER + walkerData.user_id, String(walkerId));
    await pipeline.exec();
  } catch (e) {
    logger.error('Redis set failed (active walker)', { error: e.message, walkerId });
  }
}

/**
 * Get all active walkers from Redis hash.
 * Returns array of walker objects or null on failure.
 */
async function getActiveWalkers() {
  try {
    const all = await redis.hgetall(CACHE_KEYS.ACTIVE_WALKERS);
    if (!all || Object.keys(all).length === 0) return null;
    return Object.entries(all).map(([id, json]) => {
      const w = JSON.parse(json);
      w.walker_id = parseInt(id, 10);
      return w;
    });
  } catch (e) {
    logger.error('Redis get failed (active walkers)', { error: e.message });
    return null;
  }
}

/**
 * Update a walker's current_index in Redis (called every tick instead of DB).
 */
async function updateWalkerIndex(walkerId, currentIndex) {
  try {
    const raw = await redis.hget(CACHE_KEYS.ACTIVE_WALKERS, String(walkerId));
    if (raw) {
      const walker = JSON.parse(raw);
      walker.current_index = currentIndex;
      await redis.hset(CACHE_KEYS.ACTIVE_WALKERS, String(walkerId), JSON.stringify(walker));
    }
  } catch (e) {
    logger.error('Redis update failed (walker index)', { error: e.message, walkerId });
  }
}

/**
 * Remove a walker from Redis (called when walker completes, is interrupted, etc.).
 */
async function removeActiveWalker(walkerId, userId) {
  try {
    const pipeline = redis.pipeline();
    pipeline.hdel(CACHE_KEYS.ACTIVE_WALKERS, String(walkerId));
    if (userId) pipeline.del(CACHE_KEYS.USER_WALKER + userId);
    await pipeline.exec();
  } catch (e) {
    logger.error('Redis del failed (active walker)', { error: e.message, walkerId });
  }
}

/**
 * Get the active walker for a specific user (by user_id).
 * Returns walker object or null.
 */
async function getActiveWalkerByUser(userId) {
  try {
    const walkerId = await redis.get(CACHE_KEYS.USER_WALKER + userId);
    if (!walkerId) return null;
    const raw = await redis.hget(CACHE_KEYS.ACTIVE_WALKERS, walkerId);
    if (!raw) return null;
    const walker = JSON.parse(raw);
    walker.walker_id = parseInt(walkerId, 10);
    return walker;
  } catch (e) {
    logger.error('Redis get failed (user walker)', { error: e.message, userId });
    return null;
  }
}

/**
 * Remove any active walker for a user (called when a new walk interrupts an old one).
 */
async function removeActiveWalkerByUser(userId) {
  try {
    const walkerId = await redis.get(CACHE_KEYS.USER_WALKER + userId);
    if (walkerId) {
      await removeActiveWalker(walkerId, userId);
    }
  } catch (e) {
    logger.error('Redis del failed (user walker)', { error: e.message, userId });
  }
}

// ==============================
// Equipment walk_speed cache
// ==============================

/**
 * Get cached walk_speed for a user. Returns number or null on cache miss.
 */
async function getCachedWalkSpeed(userId) {
  try {
    const val = await redis.get(CACHE_KEYS.WALK_SPEED + userId);
    if (val !== null) return parseFloat(val);
  } catch (e) { /* fall through */ }
  return null;
}

/**
 * Compute and cache the total walk_speed from a user's equipped items.
 * Queries equipment + items tables, caches the result.
 */
async function computeAndCacheWalkSpeed(gameDb, userId) {
  try {
    let totalWalkSpeed = 0;

    const [equipRows] = await gameDb.query(
      `SELECT COALESCE(e.head,0) as eq_head,
              COALESCE(e.body,0) as eq_body,
              COALESCE(e.hands,0) as eq_hands,
              COALESCE(e.shoulders,0) as eq_shoulders,
              COALESCE(e.legs,0) as eq_legs,
              COALESCE(e.weapon_right,0) as eq_weapon_right,
              COALESCE(e.weapon_left,0) as eq_weapon_left,
              COALESCE(e.ring_right,0) as eq_ring_right,
              COALESCE(e.ring_left,0) as eq_ring_left,
              COALESCE(e.amulet,0) as eq_amulet
       FROM equipment e WHERE e.user_id = ?`,
      [userId]
    );

    if (equipRows.length > 0) {
      const eq = equipRows[0];
      const equipmentIds = [
        eq.eq_head, eq.eq_body, eq.eq_hands, eq.eq_shoulders,
        eq.eq_legs, eq.eq_weapon_right, eq.eq_weapon_left,
        eq.eq_ring_right, eq.eq_ring_left, eq.eq_amulet
      ].filter(id => id && id > 0);

      if (equipmentIds.length > 0) {
        const [itemRows] = await gameDb.query(
          `SELECT i.stats FROM inventory inv
           JOIN items i ON inv.item_id = i.item_id
           WHERE inv.inventory_id IN (?)`,
          [equipmentIds]
        );

        itemRows.forEach(row => {
          if (row.stats) {
            const stats = typeof row.stats === 'string' ? JSON.parse(row.stats) : row.stats;
            totalWalkSpeed += stats.walk_speed || 0;
          }
        });
      }
    }

    await redis.set(CACHE_KEYS.WALK_SPEED + userId, String(totalWalkSpeed), 'EX', TTL.USER_EQUIPMENT);
    return totalWalkSpeed;
  } catch (e) {
    logger.error('Failed to compute walk_speed', { error: e.message, userId });
    return 0;
  }
}

/**
 * Invalidate cached walk_speed for a user (call on equip/unequip).
 */
async function invalidateWalkSpeed(userId) {
  try {
    await redis.del(CACHE_KEYS.WALK_SPEED + userId);
  } catch (e) { /* ignore */ }
}

// ==============================
// Shoutbox Messages
// ==============================

const SHOUTBOX_MAX_MESSAGES = 50;

/**
 * Get cached shoutbox messages. Returns array of message objects or null if cache miss.
 */
async function getCachedShoutboxMessages() {
  try {
    const cached = await redis.lrange(CACHE_KEYS.SHOUTBOX_MESSAGES, 0, SHOUTBOX_MAX_MESSAGES - 1);
    if (cached && cached.length > 0) {
      return cached.map(m => JSON.parse(m));
    }
  } catch (e) {
    logger.error('Redis get failed (shoutbox messages)', { error: e.message });
  }
  return null;
}

/**
 * Initialize shoutbox cache with an array of messages (oldest first / chronological order).
 * Stores in Redis list with newest at head (LPUSH) so LRANGE 0..49 returns newest first.
 * We reverse to push oldest first so newest ends up at head.
 */
async function setShoutboxMessages(messages) {
  try {
    const pipeline = redis.pipeline();
    pipeline.del(CACHE_KEYS.SHOUTBOX_MESSAGES);
    // Push in reverse order so newest is at index 0
    for (let i = messages.length - 1; i >= 0; i--) {
      pipeline.lpush(CACHE_KEYS.SHOUTBOX_MESSAGES, JSON.stringify(messages[i]));
    }
    pipeline.ltrim(CACHE_KEYS.SHOUTBOX_MESSAGES, 0, SHOUTBOX_MAX_MESSAGES - 1);
    await pipeline.exec();
  } catch (e) {
    logger.error('Redis set failed (shoutbox messages)', { error: e.message });
  }
}

/**
 * Add a new shoutbox message to the cache (pushes to head, trims to max).
 */
async function addShoutboxMessage(message) {
  try {
    await redis.lpush(CACHE_KEYS.SHOUTBOX_MESSAGES, JSON.stringify(message));
    await redis.ltrim(CACHE_KEYS.SHOUTBOX_MESSAGES, 0, SHOUTBOX_MAX_MESSAGES - 1);
  } catch (e) {
    logger.error('Redis push failed (shoutbox message)', { error: e.message });
  }
}

/**
 * Get the last polled shoutbox entry ID from Redis.
 */
async function getLastShoutboxId() {
  try {
    const val = await redis.get(CACHE_KEYS.SHOUTBOX_LAST_ID);
    return val ? parseInt(val, 10) : 0;
  } catch (e) {
    return 0;
  }
}

/**
 * Set the last polled shoutbox entry ID in Redis.
 */
async function setLastShoutboxId(id) {
  try {
    await redis.set(CACHE_KEYS.SHOUTBOX_LAST_ID, String(id));
  } catch (e) {
    logger.error('Redis set failed (shoutbox last id)', { error: e.message });
  }
}

// ==============================
// Preload static data at startup
// ==============================

/**
 * Preload all items and levels into Redis cache.
 * Call this during server startup.
 */
async function preloadStaticData(gameDb) {
  try {
    // Preload all items
    const [items] = await gameDb.query('SELECT * FROM items');
    const pipeline = redis.pipeline();
    for (const item of items) {
      pipeline.set(CACHE_KEYS.ITEM_BY_TEMPLATE + item.template_key, JSON.stringify(item));
      pipeline.set(CACHE_KEYS.ITEM_BY_ID + item.item_id, JSON.stringify(item));
    }
    await pipeline.exec();
    logger.info(`Preloaded ${items.length} items into Redis cache`);

    // Preload all levels
    const [levels] = await gameDb.query('SELECT level, xp FROM levels ORDER BY level');
    const levelPipeline = redis.pipeline();
    for (const lvl of levels) {
      levelPipeline.hset(CACHE_KEYS.LEVEL_XP, String(lvl.level), String(lvl.xp));
    }
    await levelPipeline.exec();
    logger.info(`Preloaded ${levels.length} levels into Redis cache`);

  } catch (e) {
    logger.error('Failed to preload static data into Redis', { error: e.message });
  }
}

// ── Active Spells Cache ──

const SPELL_KEY_PREFIX = 'cache:spells:active:';

/**
 * Get all active spells for a user from Redis.
 * Returns an array of spell objects or null if not cached.
 */
async function getActiveSpells(userId) {
  try {
    const raw = await redis.get(`${SPELL_KEY_PREFIX}${userId}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    logger.error('getActiveSpells error', { userId, error: e.message });
    return null;
  }
}

/**
 * Set the full active spells array for a user.
 */
async function setActiveSpells(userId, spells) {
  try {
    if (!spells || spells.length === 0) {
      await redis.del(`${SPELL_KEY_PREFIX}${userId}`);
    } else {
      await redis.set(`${SPELL_KEY_PREFIX}${userId}`, JSON.stringify(spells), 'EX', 300);
    }
  } catch (e) {
    logger.error('setActiveSpells error', { userId, error: e.message });
  }
}

/**
 * Add a spell to a user's active spells.
 */
async function addActiveSpell(userId, spell) {
  try {
    const current = (await getActiveSpells(userId)) || [];
    current.push(spell);
    await setActiveSpells(userId, current);
  } catch (e) {
    logger.error('addActiveSpell error', { userId, error: e.message });
  }
}

/**
 * Remove a spell by spellId from a user's active spells.
 */
async function removeActiveSpell(userId, spellId) {
  try {
    const current = (await getActiveSpells(userId)) || [];
    const filtered = current.filter(s => s.spellId !== spellId);
    await setActiveSpells(userId, filtered);
  } catch (e) {
    logger.error('removeActiveSpell error', { userId, error: e.message });
  }
}

/**
 * Decrement remaining on all spells for a user, returning { expired, active } arrays.
 */
async function tickActiveSpells(userId) {
  try {
    const current = (await getActiveSpells(userId)) || [];
    if (current.length === 0) return { expired: [], active: [] };
    const expired = [];
    const active = [];
    for (const spell of current) {
      spell.remaining = (spell.remaining || 0) - 1;
      if (spell.remaining <= 0) {
        expired.push(spell);
      } else {
        active.push(spell);
      }
    }
    await setActiveSpells(userId, active);
    return { expired, active };
  } catch (e) {
    logger.error('tickActiveSpells error', { userId, error: e.message });
    return { expired: [], active: [] };
  }
}

module.exports = {
  CACHE_KEYS,
  TTL,
  // Items
  getItemByTemplateKey,
  getItemById,
  // Levels
  getLevelXp,
  // Territories
  getCachedTerritories,
  invalidateTerritories,
  // Superbosses
  getCachedSuperbosses,
  invalidateSuperbosses,
  // Server Time
  getCachedServerTime,
  setCachedServerTime,
  invalidateServerTime,
  // User Settings
  getCachedUserSettings,
  invalidateUserSettings,
  // GM Status
  getCachedGMStatus,
  // Online Players
  markPlayerOnline,
  markPlayerOffline,
  updatePlayerPosition,
  getOnlinePlayers,
  cleanupOnlinePlayers,
  // last_active
  bufferLastActive,
  flushLastActive,
  // Shoutbox
  getCachedShoutboxMessages,
  setShoutboxMessages,
  addShoutboxMessage,
  getLastShoutboxId,
  setLastShoutboxId,
  // Walker
  setActiveWalker,
  getActiveWalkers,
  updateWalkerIndex,
  removeActiveWalker,
  getActiveWalkerByUser,
  removeActiveWalkerByUser,
  // Equipment walk_speed
  getCachedWalkSpeed,
  computeAndCacheWalkSpeed,
  invalidateWalkSpeed,
  // Active Spells
  getActiveSpells,
  setActiveSpells,
  addActiveSpell,
  removeActiveSpell,
  tickActiveSpells,
  // Startup
  preloadStaticData,
};
