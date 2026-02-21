const { authenticateSocket } = require('../middleware/auth');
const { gameDb } = require('../config/database');
const { ONLINE_THRESHOLD_SECONDS } = require('../config/constants');
const logger = require('../config/logger');
const { pointInPolygon } = require('../utils/geometry');
const {
  bufferLastActive, markPlayerOnline, markPlayerOffline, updatePlayerPosition,
  getOnlinePlayers, getCachedTerritories, getCachedSuperbosses, getCachedServerTime,
  getLevelXp, invalidateUserSettings, getActiveWalkerByUser
} = require('../config/cache');
const { upsertUserSettings } = require('../services/settingsService');
const { userRegions } = require('../services/regionTracker');

// Handler modules
const { initializeShoutboxHandlers, startShoutboxPolling } = require('./shoutbox');
const { registerInventoryHandlers } = require('./inventoryHandler');
const { registerMovementHandlers } = require('./movementHandler');
const { registerCollectableHandlers } = require('./collectableHandler');
const { registerEditorHandlers } = require('./editorHandler');
const { registerLogHandlers } = require('./logHandler');
const { registerSpellHandlers } = require('./spellHandler');
const { registerQuickbarHandlers } = require('./quickbarHandler');

// Store connected sockets by userId
const connectedUsers = new Map();

/**
 * Initialize Socket.io event handlers
 */
function initializeSocketHandlers(io) {
  // Authentication middleware
  io.use(authenticateSocket);

  // Shared dependencies passed to handler modules
  const deps = {
    buildPlayerState,
    addPlayerLog,
    getUserSocket,
    userRegions
  };

  // Connection event
  io.on('connection', async (socket) => {
    const user = socket.user; // { userId, username, realm }
    
    logger.info('User connected via WebSocket', { 
      userId: user.userId, 
      username: user.username,
      socketId: socket.id
    });

    // Store socket reference
    connectedUsers.set(user.userId, socket);

    // Initialize user's region entry
    userRegions.set(user.userId, null);

    // Buffer last_active in Redis (flushed to DB every 5s)
    bufferLastActive(user.userId);

    // Mark player online in Redis with current info
    try {
      const [playerInfo] = await gameDb.query(
        'SELECT user_id, username, realm, x, y, level, health, max_health FROM players WHERE user_id = ?',
        [user.userId]
      );
      if (playerInfo.length > 0) {
        const p = playerInfo[0];
        markPlayerOnline(user.userId, {
          userId: p.user_id, username: p.username, realm: p.realm,
          x: p.x, y: p.y, level: p.level, health: p.health, maxHealth: p.max_health
        });
      }
    } catch (e) {
      logger.error('Failed to mark player online in Redis', { error: e && e.message ? e.message : String(e) });
    }

    // Emit player connected event to all clients
    io.emit('player:connected', {
      userId: user.userId,
      username: user.username,
      realm: user.realm
    });

    // Send initial game state to connecting player
    await sendInitialGameState(socket, user);

    // ==================== SETTINGS ====================
    registerSettingsHandler(socket, user, io);

    // ==================== MOVEMENT ====================
    registerMovementHandlers(socket, user, io, deps);

    // ==================== INVENTORY / EQUIPMENT / ITEMS ====================
    registerInventoryHandlers(socket, user, io, deps);

    // ==================== COLLECTABLES ====================
    registerCollectableHandlers(socket, user, io);

    // ==================== SHOUTBOX/CHAT ====================
    initializeShoutboxHandlers(socket, user);

    // ==================== SPELLS ====================
    registerSpellHandlers(socket, user, io, deps);

    // ==================== QUICKBAR ====================
    registerQuickbarHandlers(socket, user);

    // ==================== PLAYER LOGS ====================
    registerLogHandlers(socket, user);

    // ==================== EDITOR (REGIONS/PATHS/WALLS/WATER) ====================
    registerEditorHandlers(socket, user, io);

    // ==================== DISCONNECT ====================
    socket.on('disconnect', () => {
      logger.info('User disconnected', { 
        userId: user.userId,
        username: user.username,
        socketId: socket.id
      });

      connectedUsers.delete(user.userId);
      userRegions.delete(user.userId);
      markPlayerOffline(user.userId);

      io.emit('player:disconnected', {
        userId: user.userId,
        username: user.username
      });
    });
  });

  // Start broadcasting online players periodically
  startOnlinePlayersBroadcast(io);

  // Start polling for new shoutbox messages
  startShoutboxPolling(io);

  logger.info('Socket.io handlers initialized');
}

/**
 * Register the user:settings:update handler.
 * Kept in index.js because it interacts with userRegions and socket.user directly.
 */
function registerSettingsHandler(socket, user, io) {
  socket.on('user:settings:update', async (data) => {
    try {
      if (!data) return;
      const s = socket.user || {};
      s.settings = s.settings || {};
      // Merge known keys
      if (typeof data.musicEnabled !== 'undefined') s.settings.musicEnabled = data.musicEnabled ? 1 : 0;
      if (typeof data.musicVolume !== 'undefined') s.settings.musicVolume = parseFloat(data.musicVolume) || 0.6;
      if (typeof data.soundsEnabled !== 'undefined') s.settings.soundsEnabled = data.soundsEnabled ? 1 : 0;
      if (typeof data.soundVolume !== 'undefined') s.settings.soundVolume = parseFloat(data.soundVolume) || 1.0;
      if (typeof data.captureSoundsEnabled !== 'undefined') s.settings.captureSoundsEnabled = data.captureSoundsEnabled ? 1 : 0;
      if (typeof data.captureSoundsVolume !== 'undefined') s.settings.captureSoundsVolume = typeof data.captureSoundsVolume === 'number' ? data.captureSoundsVolume : parseFloat(data.captureSoundsVolume) || 1.0;
      if (typeof data.collectionSoundsEnabled !== 'undefined') s.settings.collectionSoundsEnabled = data.collectionSoundsEnabled ? 1 : 0;
      if (typeof data.collectionSoundsVolume !== 'undefined') s.settings.collectionSoundsVolume = typeof data.collectionSoundsVolume === 'number' ? data.collectionSoundsVolume : parseFloat(data.collectionSoundsVolume) || 1.0;
      if (typeof data.mapVersion !== 'undefined') s.settings.mapVersion = ('' + data.mapVersion) || 'v1-compressed';
      if (typeof data.quickbarTooltipsEnabled !== 'undefined') s.settings.quickbarTooltipsEnabled = data.quickbarTooltipsEnabled ? 1 : 0;
      socket.user = s;

      // Persist settings to DB
      try {
        const userId = socket.user && socket.user.userId;
        if (userId) {
          await upsertUserSettings(gameDb, userId, s.settings);

          // Invalidate Redis settings cache
          invalidateUserSettings(userId);
        }
      } catch (e) {
        logger.error('Failed to persist user settings from socket', { error: e && e.message ? e.message : String(e), userId: socket.user && socket.user.userId });
      }

      // If music was just enabled, immediately start music for current region
      try {
        const settings = socket.user && socket.user.settings ? socket.user.settings : null;
        if (settings && settings.musicEnabled) {
          const [playerRows] = await gameDb.query('SELECT x,y FROM players WHERE user_id = ?', [user.userId]);
          if (playerRows && playerRows.length > 0) {
            const px = playerRows[0].x;
            const py = playerRows[0].y;
            const regions = require('../../gameData/regions.json');
            const matched = regions.find(r => r.music && Array.isArray(r.coordinates) && pointInPolygon(px, py, r.coordinates));
            if (matched && matched.music) {
              const vol = typeof settings.musicVolume === 'number' ? settings.musicVolume : parseFloat(settings.musicVolume) || 0.6;
              socket.emit('audio:play', { type: 'music', file: matched.music, volume: vol, loop: true, regionId: matched.id || null });
              userRegions.set(user.userId, matched.id || null);
            }
          }
        } else {
          socket.emit('audio:stop', { type: 'music' });
          userRegions.set(user.userId, null);
        }
      } catch (e) {
        logger.error('Failed to apply settings change immediately', { error: e && e.message ? e.message : String(e), userId: user.userId });
      }
    } catch (e) {
      logger.error('Failed to update socket user settings', { error: e && e.message ? e.message : String(e), userId: user.userId });
    }
  });
}

/**
 * Send initial game state to newly connected player
 */
async function sendInitialGameState(socket, user) {
  try {
    // Emit full player state
    const state = await buildPlayerState(user.userId);
    if (state) socket.emit('player:state', state);

    // Get all online players from Redis
    const onlinePlayersList = await getOnlinePlayers(gameDb, ONLINE_THRESHOLD_SECONDS);

    socket.emit('players:online', {
      players: onlinePlayersList.map(p => ({
        userId: p.userId || p.user_id,
        username: p.username,
        realm: p.realm,
        x: p.x,
        y: p.y,
        level: p.level,
        health: p.health,
        maxHealth: p.maxHealth || p.max_health
      }))
    });

    // Get territories from Redis cache
    const territories = await getCachedTerritories(gameDb);

    socket.emit('territories:list', {
      territories: territories.map(t => ({
        territoryId: t.territory_id,
        realm: t.realm,
        name: t.name,
        type: t.type,
        health: t.health,
        maxHealth: t.max_health,
        x: t.x,
        y: t.y,
        ownerRealm: t.owner_realm,
        contested: !!t.contested,
        iconName: t.icon_name,
        iconNameContested: t.icon_name_contested
      }))
    });

    // Get superbosses from Redis cache
    const superbosses = await getCachedSuperbosses(gameDb);

    socket.emit('superbosses:list', {
      superbosses: superbosses.map(b => ({
        bossId: b.boss_id,
        name: b.name,
        iconName: b.icon_name,
        health: b.health,
        maxHealth: b.max_health,
        x: b.x,
        y: b.y
      }))
    });

    // Get spawned items for user's realm
    const { COLLECTABLE_VISUAL_NAMES } = require('../config/constants');
    const [spawnedItems] = await gameDb.query(
      `SELECT spawn_id, x, y, visual_icon, realm, type
       FROM spawned_items
       WHERE (realm = ? OR realm = 'neutral') AND collected_at IS NULL`,
      [user.realm]
    );

    socket.emit('spawned-items:list', {
      spawnedItems: spawnedItems.map(si => ({
        spawnId: si.spawn_id,
        x: si.x,
        y: si.y,
        visualIcon: si.visual_icon,
        visualName: COLLECTABLE_VISUAL_NAMES[si.visual_icon] || 'Container',
        realm: si.realm,
        type: si.type
      }))
    });

    // Get server time from Redis cache
    const cachedTime = await getCachedServerTime(gameDb);

    if (cachedTime) {
      socket.emit('time:current', {
        ingameHour: cachedTime.ingame_hour,
        ingameMinute: cachedTime.ingame_minute,
        startedAt: cachedTime.started_at
      });
    }

    // Send paths and regions data
    try {
      const paths = require('../../gameData/paths.json');
      const regions = require('../../gameData/regions.json');
      socket.emit('paths:list', { paths });
      socket.emit('regions:list', { regions });

      // If player is inside a region with music, start playing
      try {
        if (state && state.position && typeof state.position.x === 'number' && typeof state.position.y === 'number') {
          const px = state.position.x;
          const py = state.position.y;
          const matched = regions.find(r => r.music && pointInPolygon(px, py, r.coordinates));
          if (matched && matched.music) {
            try {
              const settings = socket.user && socket.user.settings ? socket.user.settings : null;
              if (settings && settings.musicEnabled) {
                const vol = typeof settings.musicVolume === 'number' ? settings.musicVolume : parseFloat(settings.musicVolume) || 0.6;
                socket.emit('audio:play', {
                  type: 'music',
                  file: matched.music,
                  volume: vol,
                  loop: true,
                  regionId: matched.id || null
                });
                userRegions.set(user.userId, matched.id || null);
              }
            } catch (e) {
              logger.error('Failed to emit initial region music respecting settings', { error: e && e.message ? e.message : String(e), userId: user.userId });
            }
          }
        }
      } catch (e) {
        logger.error('Failed to determine region music for player', { error: e && e.message ? e.message : String(e), userId: user.userId });
      }
    } catch (error) {
      logger.error('Failed to load paths/regions', { error: error && error.message ? error.message : String(error) });
    }

    // Get active walker for this player (Redis first, DB fallback)
    let walker = await getActiveWalkerByUser(user.userId);

    if (!walker) {
      // Redis miss — fall back to database
      const [walkerRows] = await gameDb.query(
        `SELECT walker_id, positions, current_index, started_at, collecting_x, collecting_y, collecting_spawn_id
         FROM walkers
         WHERE user_id = ? AND status = 'walking'
         ORDER BY walker_id DESC
         LIMIT 1`,
        [user.userId]
      );
      if (walkerRows.length > 0) walker = walkerRows[0];
    }

    if (walker) {
      const positions = typeof walker.positions === 'string' ? JSON.parse(walker.positions) : walker.positions;
      const destination = positions[positions.length - 1];
      
      socket.emit('walker:restore', {
        walkerId: walker.walker_id,
        positions: positions,
        currentIndex: walker.current_index,
        destination: destination,
        collectingSpawnId: walker.collecting_spawn_id
      });
    }

  } catch (error) {
    logger.error('Failed to send initial game state', { 
      error: error.message,
      userId: user.userId
    });
  }
}

/**
 * Build the full player state (same fields as /player/position)
 */
async function buildPlayerState(userId) {
  const [playerRows] = await gameDb.query(
    `SELECT p.*, 
      COALESCE(e.head, 0) as eq_head,
      COALESCE(e.body, 0) as eq_body,
      COALESCE(e.hands, 0) as eq_hands,
      COALESCE(e.shoulders, 0) as eq_shoulders,
      COALESCE(e.legs, 0) as eq_legs,
      COALESCE(e.weapon_right, 0) as eq_weapon_right,
      COALESCE(e.weapon_left, 0) as eq_weapon_left,
      COALESCE(e.ring_right, 0) as eq_ring_right,
      COALESCE(e.ring_left, 0) as eq_ring_left,
      COALESCE(e.amulet, 0) as eq_amulet
    FROM players p
    LEFT JOIN equipment e ON p.user_id = e.user_id
    WHERE p.user_id = ?`,
    [userId]
  );

  if (playerRows.length === 0) return null;
  const player = playerRows[0];

  // Determine XP needed for next level (cached in Redis)
  let xpToNext = null;
  try {
    const nextLevel = Number(player.level) + 1;
    const nextXp = await getLevelXp(gameDb, nextLevel);
    if (nextXp !== null) {
      xpToNext = Math.max(0, nextXp - Number(player.xp));
    }
  } catch (e) {
    logger.error('Failed to fetch next level XP', { error: e && e.message ? e.message : String(e), userId });
  }

  const equipmentIds = [
    player.eq_head, player.eq_body, player.eq_hands, player.eq_shoulders,
    player.eq_legs, player.eq_weapon_right, player.eq_weapon_left,
    player.eq_ring_right, player.eq_ring_left, player.eq_amulet
  ].filter(id => id > 0);

  let totalDamageBonus = 0;
  let totalArmorBonus = 0;
  const totalStatBonuses = {
    intelligence: 0,
    dexterity: 0,
    concentration: 0,
    strength: 0,
    constitution: 0
  };

  const types = ['lightning', 'fire', 'ice', 'pierce', 'blunt', 'slash'];
  const damageTypes = {};
  const armorTypes = {};
  types.forEach(t => { damageTypes[t] = 0; armorTypes[t] = 0; });
  let totalEquipmentWeight = 0;

  if (equipmentIds.length > 0) {
    const [itemRows] = await gameDb.query(
      `SELECT i.stats, i.weight as item_weight FROM inventory inv
       JOIN items i ON inv.item_id = i.item_id
       WHERE inv.inventory_id IN (?)`,
      [equipmentIds]
    );

    itemRows.forEach(row => {
      if (row.item_weight) {
        totalEquipmentWeight += Number(row.item_weight) || 0;
      }

      if (!row.stats) return;
      const stats = typeof row.stats === 'string' ? JSON.parse(row.stats) : row.stats;

      // Aggregate attribute bonuses
      const getAttr = (k) => Number(stats[k] ?? (stats.attributes && stats.attributes[k]) ?? 0) || 0;
      totalStatBonuses.intelligence += getAttr('intelligence');
      totalStatBonuses.dexterity += getAttr('dexterity');
      totalStatBonuses.concentration += getAttr('concentration');
      totalStatBonuses.strength += getAttr('strength');
      totalStatBonuses.constitution += getAttr('constitution');

      // Scalar damage/armor
      totalDamageBonus += Number(stats.damage) || 0;
      totalArmorBonus += Number(stats.armor) || 0;

      // Per-type damage/armor
      types.forEach(t => {
        const typeDamage = Number(stats[`damage_${t}`] ?? (stats.damage && stats.damage[t]) ?? 0) || 0;
        const typeArmor = Number(stats[`armor_${t}`] ?? (stats.armor && stats.armor[t]) ?? 0) || 0;

        damageTypes[t] += typeDamage;
        armorTypes[t] += typeArmor;

        totalDamageBonus += typeDamage;
        totalArmorBonus += typeArmor;
      });
    });
  }

  const baseDamage = player.strength * 0.5 + player.intelligence * 0.3;
  const baseArmor = player.constitution * 0.5 + player.dexterity * 0.3;

  // Get walker status (Redis first, DB fallback)
  let walkerStatus = null;
  const cachedWalker = await getActiveWalkerByUser(userId);

  if (cachedWalker) {
    const positions = typeof cachedWalker.positions === 'string' ? JSON.parse(cachedWalker.positions) : cachedWalker.positions;
    walkerStatus = {
      walkerId: cachedWalker.walker_id,
      currentIndex: cachedWalker.current_index,
      totalSteps: positions.length,
      destination: positions[positions.length - 1]
    };
  } else {
    const [walkerRows] = await gameDb.query(
      `SELECT walker_id, current_index, positions, status 
       FROM walkers 
       WHERE user_id = ? AND status = 'walking' 
       ORDER BY started_at DESC LIMIT 1`,
      [userId]
    );

    if (walkerRows.length > 0) {
      const walker = walkerRows[0];
      const positions = typeof walker.positions === 'string' ? JSON.parse(walker.positions) : walker.positions;
      walkerStatus = {
        walkerId: walker.walker_id,
        currentIndex: walker.current_index,
        totalSteps: positions.length,
        destination: positions[positions.length - 1]
      };
    }
  }

  // Get server time from Redis cache
  const cachedTimeData = await getCachedServerTime(gameDb);
  const serverTime = cachedTimeData ? {
    ingameHour: cachedTimeData.ingame_hour,
    ingameMinute: cachedTimeData.ingame_minute,
    startedAt: cachedTimeData.started_at
  } : null;

  return {
    userId: player.user_id,
    username: player.username,
    realm: player.realm,
    position: { x: player.x, y: player.y },
    health: player.health,
    maxHealth: player.max_health,
    mana: player.mana,
    maxMana: player.max_mana,
    xp: player.xp,
    level: player.level,
    xpToNext,
    stats: {
      intelligence: Number(player.intelligence || 0) + totalStatBonuses.intelligence,
      dexterity: Number(player.dexterity || 0) + totalStatBonuses.dexterity,
      concentration: Number(player.concentration || 0) + totalStatBonuses.concentration,
      strength: Number(player.strength || 0) + totalStatBonuses.strength,
      constitution: Number(player.constitution || 0) + totalStatBonuses.constitution,
    },
    damage: Math.round(baseDamage + totalDamageBonus),
    armor: Math.round(baseArmor + totalArmorBonus),
    damageTypes,
    armorTypes,
    totalEquipmentWeight: Math.round(totalEquipmentWeight),
    walker: walkerStatus,
    serverTime
  };
}

/**
 * Broadcast online players list every 2 seconds
 */
function startOnlinePlayersBroadcast(io) {
  setInterval(async () => {
    try {
      const players = await getOnlinePlayers(gameDb, ONLINE_THRESHOLD_SECONDS);

      io.emit('players:online', {
        players: players.map(p => ({
          userId: p.userId || p.user_id,
          username: p.username,
          realm: p.realm,
          x: p.x,
          y: p.y,
          level: p.level,
          health: p.health,
          maxHealth: p.maxHealth || p.max_health
        }))
      });

    } catch (error) {
      logger.error('Failed to broadcast online players', { error: error.message });
    }
  }, 2000);
}

/**
 * Get connected socket for a user
 */
function getUserSocket(userId) {
  return connectedUsers.get(userId);
}

/**
 * Get all connected user IDs
 */
function getConnectedUserIds() {
  return Array.from(connectedUsers.keys());
}

/**
 * Add a log message for a specific user
 */
async function addPlayerLog(userId, message, logType = 'info', io = null) {
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    
    const [result] = await gameDb.query(
      `INSERT INTO player_logs (user_id, message, log_type, created_at)
       VALUES (?, ?, ?, ?)`,
      [userId, message, logType, timestamp]
    );

    const logData = {
      logId: result.insertId,
      userId,
      message,
      logType,
      createdAt: timestamp
    };

    if (io) {
      const userSocket = getUserSocket(userId);
      if (userSocket) {
        userSocket.emit('log:message', logData);
      }
    }

    logger.info('Player log added', { 
      userId,
      logType,
      messageLength: message.length
    });

    return { success: true, log: logData };
  } catch (error) {
    logger.error('Failed to add player log', { 
      error: error.message, 
      userId
    });
    return { success: false, error: 'Failed to add log' };
  }
}

module.exports = {
  initializeSocketHandlers,
  getUserSocket,
  getConnectedUserIds,
  addPlayerLog
};
