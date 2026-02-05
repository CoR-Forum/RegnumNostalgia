const { authenticateSocket } = require('../middleware/auth');
const { gameDb, forumDb } = require('../config/database');
const { findPath, createWalker } = require('../services/pathfinding');
const { ONLINE_THRESHOLD_SECONDS } = require('../config/constants');
const logger = require('../config/logger');

// Store connected sockets by userId
const connectedUsers = new Map();
// Track last-known region id per user for region-change detection
const userRegions = new Map();

/**
 * Initialize Socket.io event handlers
 */
function initializeSocketHandlers(io) {
  // Authentication middleware
  io.use(authenticateSocket);

  // Helper functions to convert equipment slot names between snake_case (DB) and camelCase (API)
  const slotToDb = {
    head: 'head',
    body: 'body',
    hands: 'hands',
    shoulders: 'shoulders',
    legs: 'legs',
    weaponRight: 'weapon_right',
    weaponLeft: 'weapon_left',
    ringRight: 'ring_right',
    ringLeft: 'ring_left',
    amulet: 'amulet'
  };
  const dbToSlot = {
    head: 'head',
    body: 'body',
    hands: 'hands',
    shoulders: 'shoulders',
    legs: 'legs',
    weapon_right: 'weaponRight',
    weapon_left: 'weaponLeft',
    ring_right: 'ringRight',
    ring_left: 'ringLeft',
    amulet: 'amulet'
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

    // Initialize user's region entry (will be updated in sendInitialGameState)
    userRegions.set(user.userId, null);

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

    // Allow client to notify server of settings changes so in-memory socket.user.settings stays in sync
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
        if (typeof data.mapVersion !== 'undefined') s.settings.mapVersion = ('' + data.mapVersion) || 'v1';
        socket.user = s;
        // Persist settings to DB so changes aren't lost on reconnect
        try {
          const userId = socket.user && socket.user.userId;
          if (userId) {
            const music_enabled = s.settings.musicEnabled ? 1 : 0;
            const music_volume = typeof s.settings.musicVolume === 'number' ? s.settings.musicVolume : parseFloat(s.settings.musicVolume) || 0.6;
            const sounds_enabled = s.settings.soundsEnabled ? 1 : 0;
            const sound_volume = typeof s.settings.soundVolume === 'number' ? s.settings.soundVolume : parseFloat(s.settings.soundVolume) || 1.0;
            const capture_sounds_enabled = s.settings.captureSoundsEnabled ? 1 : 0;
            const capture_sounds_volume = typeof s.settings.captureSoundsVolume === 'number' ? s.settings.captureSoundsVolume : parseFloat(s.settings.captureSoundsVolume) || 1.0;
            const collection_sounds_enabled = s.settings.collectionSoundsEnabled ? 1 : 0;
            const collection_sounds_volume = typeof s.settings.collectionSoundsVolume === 'number' ? s.settings.collectionSoundsVolume : parseFloat(s.settings.collectionSoundsVolume) || 1.0;
            const map_version = typeof s.settings.mapVersion === 'string' ? s.settings.mapVersion : (s.settings.mapVersion || 'v1');
            const updatedAt = Math.floor(Date.now() / 1000);
            await gameDb.query(
              `INSERT INTO user_settings (user_id, music_enabled, music_volume, sounds_enabled, sound_volume, capture_sounds_enabled, capture_sounds_volume, collection_sounds_enabled, collection_sounds_volume, map_version, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE
                 music_enabled = VALUES(music_enabled),
                 music_volume = VALUES(music_volume),
                 sounds_enabled = VALUES(sounds_enabled),
                 sound_volume = VALUES(sound_volume),
                 capture_sounds_enabled = VALUES(capture_sounds_enabled),
                 capture_sounds_volume = VALUES(capture_sounds_volume),
                 collection_sounds_enabled = VALUES(collection_sounds_enabled),
                 collection_sounds_volume = VALUES(collection_sounds_volume),
                 map_version = VALUES(map_version),
                 updated_at = VALUES(updated_at)`,
              [userId, music_enabled, music_volume, sounds_enabled, sound_volume, capture_sounds_enabled, capture_sounds_volume, collection_sounds_enabled, collection_sounds_volume, map_version, updatedAt]
            );
          }
        } catch (e) {
          logger.error('Failed to persist user settings from socket', { error: e && e.message ? e.message : String(e), userId: socket.user && socket.user.userId });
        }
        // If music was just enabled, immediately start music for current region
        try {
          const settings = socket.user && socket.user.settings ? socket.user.settings : null;
          if (settings && settings.musicEnabled) {
            // Determine player's current position and region
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
            // music disabled -> stop any playing music on client
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

        // Check for region change and play/stop music for this player only
        try {
          const regions = require('../../gameData/regions.json');
          const prevRegionId = userRegions.get(user.userId) || null;
          const matched = regions.find(r => Array.isArray(r.coordinates) && pointInPolygon(x, y, r.coordinates));
          const newRegionId = matched ? (matched.id || null) : null;

          if (newRegionId !== prevRegionId) {
            userRegions.set(user.userId, newRegionId);

            // Stop previous music if any
            if (prevRegionId) {
              socket.emit('audio:stop', { type: 'music', regionId: prevRegionId });
            }

            // Play new region music if configured
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
                    regionId: newRegionId
                  });
                }
              } catch (e) {
                // ignore
              }
            }
          }
        } catch (e) {
          logger.error('Failed to handle region change on position update', { error: e && e.message ? e.message : String(e), userId: user.userId });
        }

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
      const { x, y, collectableSpawnId } = data;

      if (typeof x !== 'number' || typeof y !== 'number') {
        return socket.emit('error', { message: 'Invalid coordinates' });
      }

      if (!user.realm) {
        return socket.emit('error', { message: 'Realm not selected' });
      }

      try {
        // If collecting an item, validate it
        let collectingData = null;
        if (collectableSpawnId) {
          const [spawns] = await gameDb.query(
            'SELECT spawn_id, x, y, realm, collected_at FROM spawned_items WHERE spawn_id = ?',
            [collectableSpawnId]
          );

          if (spawns.length === 0 || spawns[0].collected_at !== null) {
            return socket.emit('error', { message: 'Item not available' });
          }

          const spawn = spawns[0];
          if (spawn.realm !== 'neutral' && spawn.realm !== user.realm) {
            return socket.emit('error', { message: 'Cannot collect items from other realms' });
          }

          collectingData = {
            collectingX: spawn.x,
            collectingY: spawn.y,
            collectingSpawnId: collectableSpawnId
          };

          // Broadcast collecting state
          io.emit('collectable:collecting', {
            spawnId: collectableSpawnId,
            userId: user.userId
          });
        }

        const positions = await findPath(user.userId, x, y, user.realm);
        const walker = await createWalker(user.userId, positions, collectingData);

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
                 i.template_key, i.name, i.icon_name, i.type, i.rarity
          FROM inventory inv
          JOIN items i ON inv.item_id = i.item_id
          WHERE inv.user_id = ?
        `;
        
        const params = [user.userId];

        if (equippedIds.length > 0) {
          query += ' AND inv.inventory_id NOT IN (?)';
          params.push(equippedIds);
        }

        query += ' ORDER BY i.type, i.name, inv.inventory_id';

        const [items] = await gameDb.query(query, params);

        // Map DB snake_case fields to camelCase payload for clients
        const inventory = items.map(item => ({
          inventoryId: item.inventory_id,
          itemId: item.item_id,
          quantity: item.quantity,
          acquiredAt: item.acquired_at,
          templateKey: item.template_key,
          name: item.name,
          iconName: item.icon_name,
          type: item.type,
          rarity: item.rarity
        }));

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
                weaponRight: null, weaponLeft: null, ringRight: null, ringLeft: null, amulet: null
              }
            });
          }
          return;
        }

        const equipment = equipmentRows[0];
        const dbSlots = ['head', 'body', 'hands', 'shoulders', 'legs', 'weapon_right', 
                         'weapon_left', 'ring_right', 'ring_left', 'amulet'];

        // Get inventory IDs that are equipped
        const equippedIds = dbSlots
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
            itemDetails[item.inventory_id] = {
              inventoryId: item.inventory_id,
              templateKey: item.template_key,
              name: item.name,
              iconName: item.icon_name
            };
          });
        }

        // Build equipment response with camelCase slot names
        const equippedItems = {};
        dbSlots.forEach(dbSlot => {
          const invId = equipment[dbSlot];
          const camelSlot = dbToSlot[dbSlot];
          equippedItems[camelSlot] = invId && itemDetails[invId] ? { inventoryId: invId, item: itemDetails[invId] } : { inventoryId: null, item: null };
        });

        if (callback) callback({ success: true, equipment: equippedItems });
      } catch (error) {
        logger.error('Failed to get equipment', { error: error.message, userId: user.userId });
        if (callback) callback({ success: false, error: 'Failed to load equipment' });
      }
    });

    /**
     * Get spawned items for user's realm
     */
    socket.on('spawned-items:get', async (callback) => {
      try {
        const { COLLECTABLE_VISUAL_NAMES } = require('../config/constants');
        const [spawnedItems] = await gameDb.query(
          `SELECT spawn_id, x, y, visual_icon, realm, type
           FROM spawned_items
           WHERE (realm = ? OR realm = 'neutral') AND collected_at IS NULL`,
          [user.realm]
        );

        const spawnedItemsPayload = spawnedItems.map(si => ({
          spawnId: si.spawn_id,
          x: si.x,
          y: si.y,
          visualIcon: si.visual_icon,
          visualName: COLLECTABLE_VISUAL_NAMES[si.visual_icon] || 'Container',
          realm: si.realm,
          type: si.type
        }));

        if (callback) {
          callback({ success: true, spawnedItems: spawnedItemsPayload });
        } else {
          socket.emit('spawned-items:list', { spawnedItems: spawnedItemsPayload });
        }
      } catch (error) {
        logger.error('Failed to get spawned items', { error: error.message, userId: user.userId });
        if (callback) callback({ success: false, error: 'Failed to load spawned items' });
      }
    });

    /**
     * Handle collectable item click - initiate pathfinding to collect
     */
    socket.on('collectable:click', async (data, callback) => {
      try {
        const { spawnId } = data;

        if (!spawnId) {
          if (callback) callback({ success: false, error: 'Spawn ID required' });
          return;
        }

        // Validate spawn exists and is not collected
        const [spawns] = await gameDb.query(
          'SELECT spawn_id, x, y, realm, collected_at FROM spawned_items WHERE spawn_id = ?',
          [spawnId]
        );

        if (spawns.length === 0) {
          if (callback) callback({ success: false, error: 'Item not found' });
          return;
        }

        const spawn = spawns[0];

        if (spawn.collected_at !== null) {
          if (callback) callback({ success: false, error: 'Item already collected' });
          return;
        }

        // Check realm access
        if (spawn.realm !== 'neutral' && spawn.realm !== user.realm) {
          if (callback) callback({ success: false, error: 'Cannot collect items from other realms' });
          return;
        }

        // Start pathfinding to the item
        try {
          const positions = await findPath(user.userId, spawn.x, spawn.y, user.realm);
          const walker = await createWalker(user.userId, positions, {
            collectingX: spawn.x,
            collectingY: spawn.y,
            collectingSpawnId: spawnId
          });

          // Broadcast that this user is collecting this item (orange border)
          io.emit('collectable:collecting', {
            spawnId: spawnId,
            userId: user.userId
          });

          if (callback) {
            callback({ success: true, walker });
          } else {
            socket.emit('move:started', walker);
          }

        } catch (pathError) {
          logger.error('Failed to calculate path to collectable', {
            error: pathError.message,
            userId: user.userId,
            spawnId
          });

          if (callback) {
            callback({ 
              success: false, 
              error: pathError.message.includes('cannot') || pathError.message.includes('swim') 
                ? pathError.message 
                : 'Failed to calculate path' 
            });
          }
        }

      } catch (error) {
        logger.error('Collectable click failed', { error: error.message, userId: user.userId });
        if (callback) callback({ success: false, error: 'Failed to process collection request' });
      }
    });

        /**
         * Fetch details for a single inventory item by inventoryId
         * Used by clients to lazy-load item tooltips on hover.
         */
        socket.on('item:details', async (data, callback) => {
          try {
            const inventoryId = (data && data.inventoryId) || data;
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

            const it = rows[0];
            it.stats = typeof it.stats === 'string' ? JSON.parse(it.stats) : it.stats;

            const detail = {
              inventoryId: it.inventory_id,
              quantity: it.quantity,
              templateKey: it.template_key,
              name: it.name,
              type: it.type,
              description: it.description,
              stats: it.stats,
              rarity: it.rarity,
              level: it.level,
              equipmentSlot: it.equipment_slot,
              iconName: it.icon_name
            };

            if (callback) callback({ success: true, item: detail });
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

        // Add log message for equipping item
        await addPlayerLog(user.userId, `Equipped ${item.name}`, 'info', io);

        logger.info('Item equipped', { 
          userId: user.userId, 
          inventoryId, 
          slot,
          previousInventoryId
        });

        if (callback) {
          callback({ 
            success: true, 
            slot: dbToSlot[slot],
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

        // Emit inventory update
        socket.emit('inventory:update', { userId: user.userId });

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
      const { slot: camelSlot } = data;

      const validSlots = Object.keys(slotToDb);

      if (!camelSlot || !validSlots.includes(camelSlot)) {
        if (callback) callback({ success: false, error: 'Invalid equipment slot' });
        return;
      }

      const slot = slotToDb[camelSlot];

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

        // Get item name for log
        const [itemRows] = await gameDb.query(
          `SELECT i.name FROM inventory inv
           JOIN items i ON inv.item_id = i.item_id
           WHERE inv.inventory_id = ?`,
          [inventoryId]
        );

        // Unequip the item
        await gameDb.query(
          `UPDATE equipment SET ${slot} = NULL, updated_at = UNIX_TIMESTAMP() WHERE user_id = ?`,
          [user.userId]
        );

        // Add log message for unequipping item
        if (itemRows.length > 0) {
          await addPlayerLog(user.userId, `Unequipped ${itemRows[0].name}`, 'info', io);
        }

        logger.info('Item unequipped', { 
          userId: user.userId, 
          inventoryId, 
          slot 
        });

        if (callback) {
          callback({ 
            success: true, 
            slot: camelSlot,
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

        // Emit inventory update
        socket.emit('inventory:update', { userId: user.userId });

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
     * Handle item use (e.g., opening lucky boxes)
     */
    socket.on('item:use', async (data, callback) => {
      const { inventoryId } = data;

      if (!inventoryId) {
        if (callback) callback({ success: false, error: 'Inventory ID required' });
        return;
      }

      try {
        // Get item from inventory
        const [invRows] = await gameDb.query(
          `SELECT i.inventory_id, i.item_id, i.quantity, it.name, it.type, it.stats, it.template_key
           FROM inventory i
           JOIN items it ON i.item_id = it.item_id
           WHERE i.inventory_id = ? AND i.user_id = ?`,
          [inventoryId, user.userId]
        );

        if (invRows.length === 0) {
          if (callback) callback({ success: false, error: 'Item not found in inventory' });
          return;
        }

        const inventoryItem = invRows[0];
        const stats = typeof inventoryItem.stats === 'string' 
          ? JSON.parse(inventoryItem.stats) 
          : inventoryItem.stats;

        // Check if item has a loot table (premium boxes, etc.)
        if (!stats || !stats.loot_table) {
          if (callback) callback({ success: false, error: 'This item cannot be used' });
          return;
        }

        const lootTableKey = stats.loot_table;
        const { LOOT_TABLES } = require('../config/constants');

        if (!LOOT_TABLES[lootTableKey]) {
          if (callback) callback({ success: false, error: 'Invalid item configuration' });
          return;
        }

        // Import the loot table resolver
        const { resolveLootTable } = require('../queues/walkerQueue');

        // Resolve loot table to get rewards
        const rewards = await resolveLootTable(lootTableKey);

        if (rewards.length === 0) {
          await addPlayerLog(user.userId, 'No rewards found', 'error', io);
          // Don't show toast notification, only log it
          if (callback) callback({ success: true, message: 'Box opened', rewards: [] });
          return;
        }

        // Remove one lucky box from inventory
        if (inventoryItem.quantity > 1) {
          await gameDb.query(
            'UPDATE inventory SET quantity = quantity - 1 WHERE inventory_id = ?',
            [inventoryId]
          );
        } else {
          await gameDb.query(
            'DELETE FROM inventory WHERE inventory_id = ?',
            [inventoryId]
          );
        }

        // Add rewards to inventory
        const { addToInventory } = require('../queues/walkerQueue');
        const rewardItems = [];

        for (const reward of rewards) {
          await addToInventory(user.userId, reward.itemId, reward.quantity);

          // Get item details for response
          const [itemRows] = await gameDb.query(
            'SELECT name, icon_name, rarity FROM items WHERE item_id = ?',
            [reward.itemId]
          );

          if (itemRows.length > 0) {
            rewardItems.push({
              name: itemRows[0].name,
              iconName: itemRows[0].icon_name,
              rarity: itemRows[0].rarity,
              quantity: reward.quantity
            });
          }
        }

        // Log the action
        await addPlayerLog(
          user.userId, 
          `Opened ${inventoryItem.name} and received ${rewardItems.map(r => r.name).join(', ')}`, 
          'info', 
          io
        );

        logger.info('Item used successfully', {
          userId: user.userId,
          itemName: inventoryItem.name,
          rewards: rewardItems
        });

        // Refresh inventory for this user
        const userSocket = connectedUsers.get(user.userId);
        if (userSocket) {
          userSocket.emit('inventory:refresh');
        }

        if (callback) {
          callback({ 
            success: true, 
            message: `Opened ${inventoryItem.name}!`,
            rewards: rewardItems
          });
        }

      } catch (error) {
        logger.error('Failed to use item', { 
          error: error.message, 
          userId: user.userId,
          inventoryId
        });
        if (callback) callback({ success: false, error: 'Failed to use item' });
      }
    });

    /**
     * Handle shoutbox get messages
     */
    socket.on('shoutbox:get', async (data, callback) => {
      try {
            // Only fetch the most recent 50 messages to limit payload size
            const [messages] = await forumDb.query(
              `SELECT entryID, userID, username, time, message
               FROM wcf1_shoutbox_entry
               WHERE shoutboxID = 1
               ORDER BY time DESC
               LIMIT 50`
            );

        // Reverse to get chronological order (oldest first)
        const chronological = messages.reverse();

        // Normalize keys to camelCase
        const msgs = chronological.map(m => ({
          entryId: m.entryID,
          userId: m.userID,
          username: m.username,
          time: m.time,
          message: m.message
        }));

        if (callback) {
          callback({ success: true, messages: msgs });
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
          entryId: result.insertId,
          userId: user.userId,
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

    // ==================== PLAYER LOG OPERATIONS ====================
    
    /**
     * Handle log get messages
     */
    socket.on('log:get', async (data, callback) => {
      try {
        const [logs] = await gameDb.query(
          `SELECT log_id, user_id, message, log_type, created_at
           FROM player_logs
           WHERE user_id = ?
           ORDER BY created_at DESC
           LIMIT 50`,
          [user.userId]
        );

        // Reverse to get chronological order (oldest first)
        const chronological = logs.reverse();

        // Normalize keys to camelCase
        const logEntries = chronological.map(l => ({
          logId: l.log_id,
          userId: l.user_id,
          message: l.message,
          logType: l.log_type,
          createdAt: l.created_at
        }));

        if (callback) {
          callback({ success: true, logs: logEntries });
        }

        logger.info('Player logs retrieved', { 
          userId: user.userId,
          logCount: logs.length
        });

      } catch (error) {
        logger.error('Failed to get player logs', { 
          error: error.message, 
          userId: user.userId 
        });
        if (callback) callback({ success: false, error: 'Failed to load logs' });
      }
    });

    // ==================== EDITOR OPERATIONS ====================
    const fs = require('fs').promises;
    const path = require('path');

    const REGIONS_FILE = path.join(__dirname, '../../gameData/regions.json');
    const PATHS_FILE = path.join(__dirname, '../../gameData/paths.json');
    const WALLS_FILE = path.join(__dirname, '../../gameData/walls.json');

    async function readJsonFile(filePath) {
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data);
    }

    async function writeJsonFile(filePath, data) {
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    }

    // Get all regions
    socket.on('editor:regions:get', async (callback) => {
      try {
        const regions = await readJsonFile(REGIONS_FILE);
        callback({ success: true, data: regions });
      } catch (error) {
        logger.error('Failed to get regions', { error: error.message, userId: user.userId });
        callback({ success: false, error: 'Failed to load regions' });
      }
    });

    // Get all paths
    socket.on('editor:paths:get', async (callback) => {
      try {
        const paths = await readJsonFile(PATHS_FILE);
        callback({ success: true, data: paths });
      } catch (error) {
        logger.error('Failed to get paths', { error: error.message, userId: user.userId });
        callback({ success: false, error: 'Failed to load paths' });
      }
    });

    // Get all walls
    socket.on('editor:walls:get', async (callback) => {
      try {
        const walls = await readJsonFile(WALLS_FILE);
        callback({ success: true, data: walls });
      } catch (error) {
        logger.error('Failed to get walls', { error: error.message, userId: user.userId });
        callback({ success: false, error: 'Failed to load walls' });
      }
    });

    // Create or update region
    socket.on('editor:region:save', async (data, callback) => {
      try {
        const regions = await readJsonFile(REGIONS_FILE);
        const { item, isNew } = data;

        if (!item.id || !item.name) {
          return callback({ success: false, error: 'Region must have id and name' });
        }

        if (isNew) {
          if (regions.find(r => r.id === item.id)) {
            return callback({ success: false, error: 'Region with this id already exists' });
          }
          regions.push(item);
        } else {
          const index = regions.findIndex(r => r.id === item.id);
          if (index === -1) {
            return callback({ success: false, error: 'Region not found' });
          }
          regions[index] = item;
        }

        await writeJsonFile(REGIONS_FILE, regions);
        logger.info('Region saved', { id: item.id, userId: user.userId });
        
        // Broadcast to all clients that regions were updated
        io.emit('editor:regions:updated');
        
        callback({ success: true, data: item });
      } catch (error) {
        logger.error('Failed to save region', { error: error.message, userId: user.userId });
        callback({ success: false, error: 'Failed to save region' });
      }
    });

    // Create or update path
    socket.on('editor:path:save', async (data, callback) => {
      try {
        const paths = await readJsonFile(PATHS_FILE);
        const { item, isNew } = data;

        if (!item.id || !item.name) {
          return callback({ success: false, error: 'Path must have id and name' });
        }

        if (!item.positions) item.positions = [];
        if (typeof item.loop === 'undefined') item.loop = false;

        if (isNew) {
          if (paths.find(p => p.id === item.id)) {
            return callback({ success: false, error: 'Path with this id already exists' });
          }
          paths.push(item);
        } else {
          const index = paths.findIndex(p => p.id === item.id);
          if (index === -1) {
            return callback({ success: false, error: 'Path not found' });
          }
          paths[index] = item;
        }

        await writeJsonFile(PATHS_FILE, paths);
        logger.info('Path saved', { id: item.id, userId: user.userId });
        
        // Broadcast to all clients that paths were updated
        io.emit('editor:paths:updated');
        
        callback({ success: true, data: item });
      } catch (error) {
        logger.error('Failed to save path', { error: error.message, userId: user.userId });
        callback({ success: false, error: 'Failed to save path' });
      }
    });

    // Create or update wall
    socket.on('editor:wall:save', async (data, callback) => {
      try {
        const walls = await readJsonFile(WALLS_FILE);
        const { item, isNew } = data;

        if (!item.id || !item.name) {
          return callback({ success: false, error: 'Wall must have id and name' });
        }

        if (!item.positions) item.positions = [];

        if (isNew) {
          if (walls.find(w => w.id === item.id)) {
            return callback({ success: false, error: 'Wall with this id already exists' });
          }
          walls.push(item);
        } else {
          const index = walls.findIndex(w => w.id === item.id);
          if (index === -1) {
            return callback({ success: false, error: 'Wall not found' });
          }
          walls[index] = item;
        }

        await writeJsonFile(WALLS_FILE, walls);
        logger.info('Wall saved', { id: item.id, userId: user.userId });
        
        // Broadcast to all clients that walls were updated
        io.emit('editor:walls:updated');
        
        callback({ success: true, data: item });
      } catch (error) {
        logger.error('Failed to save wall', { error: error.message, userId: user.userId });
        callback({ success: false, error: 'Failed to save wall' });
      }
    });

    // Delete region
    socket.on('editor:region:delete', async (data, callback) => {
      try {
        const regions = await readJsonFile(REGIONS_FILE);
        const { id } = data;

        const index = regions.findIndex(r => r.id === id);
        if (index === -1) {
          return callback({ success: false, error: 'Region not found' });
        }

        regions.splice(index, 1);
        await writeJsonFile(REGIONS_FILE, regions);
        logger.info('Region deleted', { id, userId: user.userId });
        
        // Broadcast to all clients that regions were updated
        io.emit('editor:regions:updated');
        
        callback({ success: true });
      } catch (error) {
        logger.error('Failed to delete region', { error: error.message, userId: user.userId });
        callback({ success: false, error: 'Failed to delete region' });
      }
    });

    // Delete path
    socket.on('editor:path:delete', async (data, callback) => {
      try {
        const paths = await readJsonFile(PATHS_FILE);
        const { id } = data;

        const index = paths.findIndex(p => p.id === id);
        if (index === -1) {
          return callback({ success: false, error: 'Path not found' });
        }

        paths.splice(index, 1);
        await writeJsonFile(PATHS_FILE, paths);
        logger.info('Path deleted', { id, userId: user.userId });
        
        // Broadcast to all clients that paths were updated
        io.emit('editor:paths:updated');
        
        callback({ success: true });
      } catch (error) {
        logger.error('Failed to delete path', { error: error.message, userId: user.userId });
        callback({ success: false, error: 'Failed to delete path' });
      }
    });

    // Delete wall
    socket.on('editor:wall:delete', async (data, callback) => {
      try {
        const walls = await readJsonFile(WALLS_FILE);
        const { id } = data;

        const index = walls.findIndex(w => w.id === id);
        if (index === -1) {
          return callback({ success: false, error: 'Wall not found' });
        }

        walls.splice(index, 1);
        await writeJsonFile(WALLS_FILE, walls);
        logger.info('Wall deleted', { id, userId: user.userId });
        
        // Broadcast to all clients that walls were updated
        io.emit('editor:walls:updated');
        
        callback({ success: true });
      } catch (error) {
        logger.error('Failed to delete wall', { error: error.message, userId: user.userId });
        callback({ success: false, error: 'Failed to delete wall' });
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
      // Remove region tracking
      userRegions.delete(user.userId);

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

    const playersPayload = onlinePlayers.map(p => ({
      userId: p.user_id,
      username: p.username,
      realm: p.realm,
      x: p.x,
      y: p.y,
      level: p.level,
      health: p.health,
      maxHealth: p.max_health
    }));

    socket.emit('players:online', { players: playersPayload });

    // Get territories
    const [territories] = await gameDb.query(
      `SELECT territory_id, realm, name, type, health, max_health, x, y,
              owner_realm, contested, icon_name, icon_name_contested
       FROM territories
       ORDER BY territory_id`
    );

    const territoriesPayload = territories.map(t => ({
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
    }));

    socket.emit('territories:list', { territories: territoriesPayload });

    // Get superbosses
    const [superbosses] = await gameDb.query(
      `SELECT boss_id, name, icon_name, health, max_health, x, y
       FROM superbosses
       ORDER BY boss_id`
    );

    const superbossesPayload = superbosses.map(b => ({
      bossId: b.boss_id,
      name: b.name,
      iconName: b.icon_name,
      health: b.health,
      maxHealth: b.max_health,
      x: b.x,
      y: b.y
    }));

    socket.emit('superbosses:list', { superbosses: superbossesPayload });

    // Get spawned items for user's realm
    const { COLLECTABLE_VISUAL_NAMES } = require('../config/constants');
    const [spawnedItems] = await gameDb.query(
      `SELECT spawn_id, x, y, visual_icon, realm, type
       FROM spawned_items
       WHERE (realm = ? OR realm = 'neutral') AND collected_at IS NULL`,
      [user.realm]
    );

    const spawnedItemsPayload = spawnedItems.map(si => ({
      spawnId: si.spawn_id,
      x: si.x,
      y: si.y,
      visualIcon: si.visual_icon,
      visualName: COLLECTABLE_VISUAL_NAMES[si.visual_icon] || 'Container',
      realm: si.realm,
      type: si.type
    }));

    socket.emit('spawned-items:list', { spawnedItems: spawnedItemsPayload });

    // Get server time
    const [timeRows] = await gameDb.query(
      'SELECT ingame_hour, ingame_minute, started_at FROM server_time WHERE id = 1'
    );

    if (timeRows.length > 0) {
      const tr = timeRows[0];
      socket.emit('time:current', {
        ingameHour: tr.ingame_hour,
        ingameMinute: tr.ingame_minute,
        startedAt: tr.started_at
      });
    }

    // Send paths and regions data (load directly from gameData JSON)
    try {
      const paths = require('../../gameData/paths.json');
      const regions = require('../../gameData/regions.json');
      socket.emit('paths:list', { paths });
      socket.emit('regions:list', { regions });
      // If this player is inside a region that has music configured,
      // instruct only the connecting socket to play that music.
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
                // record initial region
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

    // Get active walker for this player
    const [walkerRows] = await gameDb.query(
      `SELECT walker_id, positions, current_index, started_at, collecting_x, collecting_y, collecting_spawn_id
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
/**
 * Simple point-in-polygon test (ray-casting)
 * polygon: array of [x,y] points
 */
function pointInPolygon(px, py, polygon) {
  if (!Array.isArray(polygon) || polygon.length === 0) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];

    const intersect = ((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / (yj - yi + 0.0) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
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

      const playersPayload = players.map(p => ({
        userId: p.user_id,
        username: p.username,
        realm: p.realm,
        x: p.x,
        y: p.y,
        level: p.level,
        health: p.health,
        maxHealth: p.max_health
      }));

      io.emit('players:online', { players: playersPayload });

    } catch (error) {
      logger.error('Failed to broadcast online players', { error: error.message });
    }
  }, 2000); // Every 2 seconds
}

/**
 * Poll for new shoutbox messages every 1 second
 * Limit fetches to at most 50 messages per tick to avoid huge backfills.
 */
let lastShoutboxId = 0;

async function startShoutboxPolling(io) {
  try {
    // Initialize lastShoutboxId to the current max entryID so we don't
    // accidentally broadcast the entire history when the service starts.
    const [rows] = await forumDb.query(
      `SELECT MAX(entryID) as maxId FROM wcf1_shoutbox_entry WHERE shoutboxID = 1`
    );
    if (rows && rows.length > 0 && rows[0].maxId) {
      lastShoutboxId = rows[0].maxId;
    }
  } catch (err) {
    logger.error('Failed to initialize lastShoutboxId', { error: err.message });
  }

  setInterval(async () => {
    try {
      const [messages] = await forumDb.query(
        `SELECT entryID, userID, username, time, message
         FROM wcf1_shoutbox_entry
         WHERE shoutboxID = 1 AND entryID > ?
         ORDER BY entryID ASC
         LIMIT 50`,
        [lastShoutboxId]
      );

      if (messages.length > 0) {
        // Update last ID
        lastShoutboxId = messages[messages.length - 1].entryID;

        // Broadcast each new message to all clients
        messages.forEach(msg => {
          io.emit('shoutbox:message', {
            entryId: msg.entryID,
            userId: msg.userID,
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

/**
 * Add a log message for a specific user
 * @param {number} userId - The user ID to send the log to
 * @param {string} message - The log message
 * @param {string} logType - Type of log: 'info', 'success', 'error', 'warning', 'combat'
 * @param {object} io - The socket.io instance (optional, for real-time sending)
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
      userId: userId,
      message: message,
      logType: logType,
      createdAt: timestamp
    };

    // If io is provided and user is connected, send the log in real-time
    if (io) {
      const userSocket = getUserSocket(userId);
      if (userSocket) {
        userSocket.emit('log:message', logData);
      }
    }

    logger.info('Player log added', { 
      userId: userId,
      logType: logType,
      messageLength: message.length
    });

    return { success: true, log: logData };
  } catch (error) {
    logger.error('Failed to add player log', { 
      error: error.message, 
      userId: userId 
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
