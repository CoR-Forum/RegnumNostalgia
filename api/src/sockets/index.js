const { authenticateSocket } = require('../middleware/auth');
const { gameDb, forumDb } = require('../config/database');
const { findPath, createWalker } = require('../services/pathfinding');
const { ONLINE_THRESHOLD_SECONDS } = require('../config/constants');
const logger = require('../config/logger');

// Store connected sockets by userId
const connectedUsers = new Map();

/**
 * Initialize Socket.io event handlers
 */
function initializeSocketHandlers(io) {
  // Authentication middleware
  io.use(authenticateSocket);

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

    // Update player's last_active
    try {
      await gameDb.query(
        'UPDATE players SET last_active = UNIX_TIMESTAMP() WHERE user_id = ?',
        [user.userId]
      );
    } catch (error) {
      logger.error('Failed to update last_active on connect', { 
        error: error.message,
        userId: user.userId
      });
    }

    // Emit player connected event to all clients
    io.emit('player:connected', {
      userId: user.userId,
      username: user.username,
      realm: user.realm
    });

    // Send initial game state to connecting player
    await sendInitialGameState(socket, user);

    /**
     * Handle position updates from client
     */
    socket.on('position:update', async (data, callback) => {
      const { x, y } = data || {};

      if (typeof x !== 'number' || typeof y !== 'number') {
        const err = { message: 'Invalid coordinates' };
        if (callback) return callback({ success: false, error: err.message });
        return socket.emit('error', err);
      }

      try {
        await gameDb.query(
          'UPDATE players SET x = ?, y = ?, last_active = UNIX_TIMESTAMP() WHERE user_id = ?',
          [x, y, user.userId]
        );

        // Broadcast position to all clients
        io.emit('players:position', [{
          userId: user.userId,
          username: user.username,
          x,
          y,
          realm: user.realm
        }]);

        if (callback) callback({ success: true, x, y });

      } catch (error) {
        logger.error('Failed to update position', { 
          error: error.message,
          userId: user.userId 
        });
        if (callback) callback({ success: false, error: 'Failed to update position' });
      }
    });

    /**
     * Handle movement requests (pathfinding)
     */
    socket.on('move:request', async (data) => {
      const { x, y } = data;

      if (typeof x !== 'number' || typeof y !== 'number') {
        return socket.emit('error', { message: 'Invalid coordinates' });
      }

      if (!user.realm) {
        return socket.emit('error', { message: 'Realm not selected' });
      }

      try {
        const positions = await findPath(user.userId, x, y, user.realm);
        const walker = await createWalker(user.userId, positions);

        socket.emit('move:started', walker);

      } catch (error) {
        logger.error('Move request failed', {
          error: error.message,
          userId: user.userId,
          destination: { x, y }
        });

        socket.emit('error', { 
          message: error.message.includes('cannot') || error.message.includes('swim') 
            ? error.message 
            : 'Failed to calculate path' 
        });
      }
    });

    /**     * Handle inventory requests
     */
    socket.on('inventory:get', async (callback) => {
      try {
        // Get equipped inventory IDs to exclude them
        const [equipmentRows] = await gameDb.query(
          'SELECT head, body, hands, shoulders, legs, weapon_right, weapon_left, ring_right, ring_left, amulet FROM equipment WHERE user_id = ?',
          [user.userId]
        );

        const equippedIds = equipmentRows.length > 0 ? 
          Object.values(equipmentRows[0]).filter(id => id > 0) : [];

        // Get inventory items
        // Return only minimal fields for the inventory list. Detailed fields
        // (description, stats, rarity, level, equipment_slot, icon_name)
        // must be requested individually via `item:details` on hover.
        let query = `
          SELECT inv.inventory_id, inv.item_id, inv.quantity, inv.acquired_at,
                 i.template_key, i.name, i.icon_name
          FROM inventory inv
          JOIN items i ON inv.item_id = i.item_id
          WHERE inv.user_id = ?
        `;
        
        const params = [user.userId];

        if (equippedIds.length > 0) {
          query += ' AND inv.inventory_id NOT IN (?)';
          params.push(equippedIds);
        }

        query += ' ORDER BY inv.acquired_at DESC';

        const [items] = await gameDb.query(query, params);

        // Return rows as-is (no stats parsing) — minimal payload
        const inventory = items.map(item => ({ ...item }));

        if (callback) callback({ success: true, items: inventory });
      } catch (error) {
        logger.error('Failed to get inventory', { error: error.message, userId: user.userId });
        if (callback) callback({ success: false, error: 'Failed to load inventory' });
      }
    });

      // Provide full player stats on-demand via WebSocket
      socket.on('player:stats:get', async (callback) => {
        try {
          const state = await buildPlayerState(user.userId);
          if (callback) callback({ success: true, state });
        } catch (err) {
          logger.error('Failed to get player stats via socket', { error: err.message, userId: user.userId });
          if (callback) callback({ success: false, error: 'Failed to load player stats' });
        }
      });

    /**
     * Handle equipment requests
     */
    socket.on('equipment:get', async (callback) => {
      try {
        const [equipmentRows] = await gameDb.query(
          'SELECT * FROM equipment WHERE user_id = ?',
          [user.userId]
        );

        if (equipmentRows.length === 0) {
          // Create equipment row if it doesn't exist
          await gameDb.query(
            'INSERT INTO equipment (user_id, created_at, updated_at) VALUES (?, UNIX_TIMESTAMP(), UNIX_TIMESTAMP())',
            [user.userId]
          );

          if (callback) {
            callback({
              success: true,
              equipment: {
                head: null, body: null, hands: null, shoulders: null, legs: null,
                weapon_right: null, weapon_left: null, ring_right: null, ring_left: null, amulet: null
              }
            });
          }
          return;
        }

        const equipment = equipmentRows[0];
        const slots = ['head', 'body', 'hands', 'shoulders', 'legs', 'weapon_right', 
                       'weapon_left', 'ring_right', 'ring_left', 'amulet'];

        // Get inventory IDs that are equipped
        const equippedIds = slots
          .map(slot => equipment[slot])
          .filter(id => id > 0);

        let itemDetails = {};

        if (equippedIds.length > 0) {
          // Return only minimal fields for equipped items. Detailed fields
          // will be fetched on hover via `item:details`.
          const [itemRows] = await gameDb.query(
            `SELECT inv.inventory_id, i.template_key, i.name, i.icon_name
             FROM inventory inv
             JOIN items i ON inv.item_id = i.item_id
             WHERE inv.inventory_id IN (?)`,
            [equippedIds]
          );

          itemRows.forEach(item => {
            itemDetails[item.inventory_id] = { ...item };
          });
        }

        // Build equipment response
        const equippedItems = {};
        slots.forEach(slot => {
          const invId = equipment[slot];
          equippedItems[slot] = invId && itemDetails[invId] ? { inventoryId: invId, item: itemDetails[invId] } : { inventoryId: null, item: null };
        });

        if (callback) callback({ success: true, equipment: equippedItems });
      } catch (error) {
        logger.error('Failed to get equipment', { error: error.message, userId: user.userId });
        if (callback) callback({ success: false, error: 'Failed to load equipment' });
      }
    });

        /**
         * Fetch details for a single inventory item by inventory_id
         * Used by clients to lazy-load item tooltips on hover.
         */
        socket.on('item:details', async (data, callback) => {
          try {
            const inventoryId = (data && (data.inventoryId || data.inventory_id)) || data;
            if (!inventoryId) {
              if (callback) callback({ success: false, error: 'Inventory ID required' });
              return;
            }

            const [rows] = await gameDb.query(
              `SELECT inv.inventory_id, inv.quantity, i.template_key, i.name, i.type, i.description, i.stats, i.rarity, i.level, i.equipment_slot, i.icon_name
               FROM inventory inv
               JOIN items i ON inv.item_id = i.item_id
               WHERE inv.inventory_id = ?`,
              [inventoryId]
            );

            if (!rows || rows.length === 0) {
              if (callback) callback({ success: false, error: 'Item not found' });
              return;
            }

            const item = rows[0];
            item.stats = typeof item.stats === 'string' ? JSON.parse(item.stats) : item.stats;

            if (callback) callback({ success: true, item });
          } catch (error) {
            logger.error('Failed to fetch item details', { error: error.message, userId: user.userId });
            if (callback) callback({ success: false, error: 'Failed to load item details' });
          }
        });

    /**
     * Handle equipment equip
     */
    socket.on('equipment:equip', async (data, callback) => {
      const { inventoryId } = data;

      if (!inventoryId) {
        if (callback) callback({ success: false, error: 'Inventory ID required' });
        return;
      }

      try {
        // Get item details from inventory
        const [invRows] = await gameDb.query(
          `SELECT inv.inventory_id, inv.user_id, i.equipment_slot, i.level, i.name
           FROM inventory inv
           JOIN items i ON inv.item_id = i.item_id
           WHERE inv.inventory_id = ?`,
          [inventoryId]
        );

        if (invRows.length === 0) {
          if (callback) callback({ success: false, error: 'Item not found' });
          return;
        }

        const item = invRows[0];

        // Verify ownership
        if (item.user_id !== user.userId) {
          if (callback) callback({ success: false, error: 'Not your item' });
          return;
        }

        // Check if item can be equipped
        if (!item.equipment_slot) {
          if (callback) callback({ success: false, error: 'Item cannot be equipped' });
          return;
        }

        // Get player level
        const [playerRows] = await gameDb.query(
          'SELECT level FROM players WHERE user_id = ?',
          [user.userId]
        );

        if (playerRows.length === 0) {
          if (callback) callback({ success: false, error: 'Player not found' });
          return;
        }

        // Check level requirement
        if (item.level > playerRows[0].level) {
          if (callback) callback({ success: false, error: `Level ${item.level} required to equip this item` });
          return;
        }

        // Get current equipment
        const [equipmentRows] = await gameDb.query(
          'SELECT * FROM equipment WHERE user_id = ?',
          [user.userId]
        );

        if (equipmentRows.length === 0) {
          // Create equipment row
          await gameDb.query(
            'INSERT INTO equipment (user_id, created_at, updated_at) VALUES (?, UNIX_TIMESTAMP(), UNIX_TIMESTAMP())',
            [user.userId]
          );
        }

        const slot = item.equipment_slot;

        // Check if slot is already occupied
        const [currentEquip] = await gameDb.query(
          `SELECT ${slot} FROM equipment WHERE user_id = ?`,
          [user.userId]
        );

        const previousInventoryId = currentEquip[0][slot];

        // Equip the item
        await gameDb.query(
          `UPDATE equipment SET ${slot} = ?, updated_at = UNIX_TIMESTAMP() WHERE user_id = ?`,
          [inventoryId, user.userId]
        );

        logger.info('Item equipped', { 
          userId: user.userId, 
          inventoryId, 
          slot,
          previousInventoryId
        });

        if (callback) {
          callback({ 
            success: true, 
            slot,
            equippedInventoryId: inventoryId,
            unequippedInventoryId: previousInventoryId > 0 ? previousInventoryId : null
          });
        }

        // Emit updated player stats to the player who equipped the item
        try {
          const updatedState = await buildPlayerState(user.userId);
          if (updatedState) socket.emit('player:state', updatedState);
        } catch (err) {
          logger.error('Failed to emit updated player state after equip', { error: err.message, userId: user.userId });
        }

      } catch (error) {
        logger.error('Failed to equip item', { 
          error: error.message, 
          userId: user.userId,
          inventoryId
        });
        if (callback) callback({ success: false, error: 'Failed to equip item' });
      }
    });

    /**
     * Handle equipment unequip
     */
    socket.on('equipment:unequip', async (data, callback) => {
      const { slot } = data;

      const validSlots = ['head', 'body', 'hands', 'shoulders', 'legs', 
                          'weapon_right', 'weapon_left', 'ring_right', 'ring_left', 'amulet'];

      if (!slot || !validSlots.includes(slot)) {
        if (callback) callback({ success: false, error: 'Invalid equipment slot' });
        return;
      }

      try {
        // Get current equipped item
        const [equipmentRows] = await gameDb.query(
          `SELECT ${slot} FROM equipment WHERE user_id = ?`,
          [user.userId]
        );

        if (equipmentRows.length === 0 || !equipmentRows[0][slot]) {
          if (callback) callback({ success: false, error: 'No item equipped in that slot' });
          return;
        }

        const inventoryId = equipmentRows[0][slot];

        // Unequip the item
        await gameDb.query(
          `UPDATE equipment SET ${slot} = NULL, updated_at = UNIX_TIMESTAMP() WHERE user_id = ?`,
          [user.userId]
        );

        logger.info('Item unequipped', { 
          userId: user.userId, 
          inventoryId, 
          slot 
        });

        if (callback) {
          callback({ 
            success: true, 
            slot,
            unequippedInventoryId: inventoryId
          });
        }

        // Emit updated player stats to the player who unequipped the item
        try {
          const updatedState = await buildPlayerState(user.userId);
          if (updatedState) socket.emit('player:state', updatedState);
        } catch (err) {
          logger.error('Failed to emit updated player state after unequip', { error: err.message, userId: user.userId });
        }

      } catch (error) {
        logger.error('Failed to unequip item', { 
          error: error.message, 
          userId: user.userId,
          slot
        });
        if (callback) callback({ success: false, error: 'Failed to unequip item' });
      }
    });

    /**
     * Handle shoutbox get messages
     */
    socket.on('shoutbox:get', async (data, callback) => {
      try {
        // Only fetch the most recent 20 messages to limit payload size
        const [messages] = await forumDb.query(
          `SELECT entryID, userID, username, time, message
           FROM wcf1_shoutbox_entry
           WHERE shoutboxID = 1
           ORDER BY time DESC
           LIMIT 20`
        );

        // Reverse to get chronological order (oldest first)
        const chronological = messages.reverse();

        if (callback) {
          callback({ success: true, messages: chronological });
        }

        logger.info('Shoutbox messages retrieved', { 
          userId: user.userId,
          messageCount: messages.length
        });

      } catch (error) {
        logger.error('Failed to get shoutbox messages', { 
          error: error.message, 
          userId: user.userId 
        });
        if (callback) callback({ success: false, error: 'Failed to load messages' });
      }
    });

    /**
     * Handle shoutbox send messages
     */
    socket.on('shoutbox:send', async (data, callback) => {
      const { message } = data;

      if (!message || message.trim().length === 0) {
        if (callback) callback({ success: false, error: 'Message required' });
        return;
      }

      if (message.length > 1000) {
        if (callback) callback({ success: false, error: 'Message too long (max 1000 characters)' });
        return;
      }

      try {
        const timestamp = Math.floor(Date.now() / 1000);

        const [result] = await forumDb.query(
          `INSERT INTO wcf1_shoutbox_entry (shoutboxID, userID, username, time, message)
           VALUES (1, ?, ?, ?, ?)`,
          [user.userId, user.username, timestamp, message.trim()]
        );

        const messageData = {
          entryID: result.insertId,
          userID: user.userId,
          username: user.username,
          time: timestamp,
          message: message.trim()
        };

        // Broadcast to all clients except sender (they get it via callback)
        socket.broadcast.emit('shoutbox:message', messageData);

        // Update last shoutbox ID to prevent polling from re-sending this message
        if (result.insertId > lastShoutboxId) {
          lastShoutboxId = result.insertId;
        }

        if (callback) {
          callback({ success: true, message: messageData });
        }

        logger.info('Shoutbox message sent', { 
          userId: user.userId,
          username: user.username,
          messageLength: message.length
        });

      } catch (error) {
        logger.error('Failed to send shoutbox message', { 
          error: error.message, 
          userId: user.userId 
        });
        if (callback) callback({ success: false, error: 'Failed to send message' });
      }
    });

    /**
     * Handle disconnection
     */
    socket.on('disconnect', () => {
      logger.info('User disconnected', { 
        userId: user.userId,
        username: user.username,
        socketId: socket.id
      });

      // Remove from connected users
      connectedUsers.delete(user.userId);

      // Broadcast disconnection
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
 * Send initial game state to newly connected player
 */
async function sendInitialGameState(socket, user) {
  try {
    // Emit full player state using helper (keeps logic consistent with HTTP endpoint)
    const state = await buildPlayerState(user.userId);
    if (state) socket.emit('player:state', state);

    // Get all online players
    const [onlinePlayers] = await gameDb.query(
      `SELECT user_id, username, realm, x, y, level, health, max_health
       FROM players 
       WHERE last_active > DATE_SUB(NOW(), INTERVAL ? SECOND)
       AND realm IS NOT NULL`,
      [ONLINE_THRESHOLD_SECONDS]
    );

    socket.emit('players:online', { players: onlinePlayers });

    // Get territories
    const [territories] = await gameDb.query(
      `SELECT territory_id, realm, name, type, health, max_health, x, y,
              owner_realm, contested, icon_name, icon_name_contested
       FROM territories
       ORDER BY territory_id`
    );

    socket.emit('territories:list', { territories });

    // Get superbosses
    const [superbosses] = await gameDb.query(
      `SELECT boss_id, name, icon_name, health, max_health, x, y
       FROM superbosses
       ORDER BY boss_id`
    );

    socket.emit('superbosses:list', { superbosses });

    // Get server time
    const [timeRows] = await gameDb.query(
      'SELECT ingame_hour, ingame_minute, started_at FROM server_time WHERE id = 1'
    );

    if (timeRows.length > 0) {
      socket.emit('time:current', timeRows[0]);
    }

    // Send paths and regions data
    try {
      const { loadPaths } = require('../routes/paths');
      const { loadRegions } = require('../routes/regions');
      
      const paths = await loadPaths();
      socket.emit('paths:list', { paths });
      
      const regions = await loadRegions();
      socket.emit('regions:list', { regions });
    } catch (error) {
      logger.error('Failed to load paths/regions', { error: error.message });
    }

    // Get active walker for this player
    const [walkerRows] = await gameDb.query(
      `SELECT walker_id, positions, current_index, started_at
       FROM walkers
       WHERE user_id = ? AND status = 'walking'
       ORDER BY walker_id DESC
       LIMIT 1`,
      [user.userId]
    );

    if (walkerRows.length > 0) {
      const walker = walkerRows[0];
      const positions = typeof walker.positions === 'string' ? JSON.parse(walker.positions) : walker.positions;
      const destination = positions[positions.length - 1];
      
      socket.emit('walker:restore', {
        walkerId: walker.walker_id,
        positions: positions,
        currentIndex: walker.current_index,
        destination: destination
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

  const equipmentIds = [
    player.eq_head, player.eq_body, player.eq_hands, player.eq_shoulders,
    player.eq_legs, player.eq_weapon_right, player.eq_weapon_left,
    player.eq_ring_right, player.eq_ring_left, player.eq_amulet
  ].filter(id => id > 0);

  let totalDamageBonus = 0;
  let totalArmorBonus = 0;

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
        totalDamageBonus += stats.damage || 0;
        totalArmorBonus += stats.armor || 0;
      }
    });
  }

  const baseDamage = player.strength * 0.5 + player.intelligence * 0.3;
  const baseArmor = player.constitution * 0.5 + player.dexterity * 0.3;

  // Get walker status
  const [walkerRows] = await gameDb.query(
    `SELECT walker_id, current_index, positions, status 
     FROM walkers 
     WHERE user_id = ? AND status = 'walking' 
     ORDER BY started_at DESC LIMIT 1`,
    [userId]
  );

  let walkerStatus = null;
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

  // Get server time
  const [timeRows] = await gameDb.query('SELECT * FROM server_time WHERE id = 1');
  const serverTime = timeRows.length > 0 ? {
    ingameHour: timeRows[0].ingame_hour,
    ingameMinute: timeRows[0].ingame_minute,
    startedAt: timeRows[0].started_at
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
    stats: {
      intelligence: player.intelligence,
      dexterity: player.dexterity,
      concentration: player.concentration,
      strength: player.strength,
      constitution: player.constitution
    },
    damage: Math.round(baseDamage + totalDamageBonus),
    armor: Math.round(baseArmor + totalArmorBonus),
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
      const [players] = await gameDb.query(
        `SELECT user_id, username, realm, x, y, level, health, max_health
         FROM players 
         WHERE last_active > DATE_SUB(NOW(), INTERVAL ? SECOND)
         AND realm IS NOT NULL`,
        [ONLINE_THRESHOLD_SECONDS]
      );

      io.emit('players:online', { players });

    } catch (error) {
      logger.error('Failed to broadcast online players', { error: error.message });
    }
  }, 2000); // Every 2 seconds
}

/**
 * Poll for new shoutbox messages every 1 second
 */
let lastShoutboxId = 0;

function startShoutboxPolling(io) {
  setInterval(async () => {
    try {
      const [messages] = await forumDb.query(
        `SELECT entryID, userID, username, time, message
         FROM wcf1_shoutbox_entry
         WHERE shoutboxID = 1 AND entryID > ?
         ORDER BY entryID ASC`,
        [lastShoutboxId]
      );

      if (messages.length > 0) {
        // Update last ID
        lastShoutboxId = messages[messages.length - 1].entryID;

        // Broadcast each new message to all clients
        messages.forEach(msg => {
          io.emit('shoutbox:message', {
            entryID: msg.entryID,
            userID: msg.userID,
            username: msg.username,
            time: msg.time,
            message: msg.message
          });
        });

        logger.info('Broadcasted new shoutbox messages', { count: messages.length });
      }

    } catch (error) {
      logger.error('Failed to poll shoutbox messages', { error: error.message });
    }
  }, 1000); // Every 1 second
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

module.exports = {
  initializeSocketHandlers,
  getUserSocket,
  getConnectedUserIds
};
