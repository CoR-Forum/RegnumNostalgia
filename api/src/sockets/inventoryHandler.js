const { gameDb } = require('../config/database');
const logger = require('../config/logger');
const { invalidateWalkSpeed } = require('../config/cache');

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

/**
 * Register inventory, equipment, and item-related socket handlers.
 * @param {object} socket  - The connected socket instance
 * @param {object} user    - Authenticated user { userId, username, realm }
 * @param {object} io      - Socket.io server instance
 * @param {object} deps    - Shared helpers { buildPlayerState, addPlayerLog, getUserSocket }
 */
function registerInventoryHandlers(socket, user, io, deps) {
  const { buildPlayerState, addPlayerLog, getUserSocket } = deps;

  /**
   * Handle inventory requests
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

      // Get inventory items — minimal fields for the list.
      // Detailed fields loaded on hover via `item:details`.
      let query = `
        SELECT inv.inventory_id, inv.item_id, inv.quantity, inv.acquired_at,
               i.template_key, i.name, i.icon_name, i.type, i.rarity, i.stats
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

      const inventory = items.map(item => {
        let parsedStats = null;
        try {
          parsedStats = typeof item.stats === 'string' ? JSON.parse(item.stats) : item.stats;
        } catch (e) { /* ignore */ }
        return {
          inventoryId: item.inventory_id,
          itemId: item.item_id,
          quantity: item.quantity,
          acquiredAt: item.acquired_at,
          templateKey: item.template_key,
          name: item.name,
          iconName: item.icon_name,
          type: item.type,
          rarity: item.rarity,
          spellKey: parsedStats?.spell || null,
          cooldown: parsedStats?.cooldown || 0
        };
      });

      if (callback) callback({ success: true, items: inventory });
    } catch (error) {
      logger.error('Failed to get inventory', { error: error.message, userId: user.userId });
      if (callback) callback({ success: false, error: 'Failed to load inventory' });
    }
  });

  /**
   * Provide full player stats on-demand via WebSocket
   */
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

      const equippedIds = dbSlots
        .map(slot => equipment[slot])
        .filter(id => id > 0);

      let itemDetails = {};

      if (equippedIds.length > 0) {
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
   * Fetch details for a single inventory item by inventoryId.
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

      if (item.user_id !== user.userId) {
        if (callback) callback({ success: false, error: 'Not your item' });
        return;
      }

      if (!item.equipment_slot) {
        if (callback) callback({ success: false, error: 'Item cannot be equipped' });
        return;
      }

      const [playerRows] = await gameDb.query(
        'SELECT level FROM players WHERE user_id = ?',
        [user.userId]
      );

      if (playerRows.length === 0) {
        if (callback) callback({ success: false, error: 'Player not found' });
        return;
      }

      if (item.level > playerRows[0].level) {
        if (callback) callback({ success: false, error: `Level ${item.level} required to equip this item` });
        return;
      }

      const [equipmentRows] = await gameDb.query(
        'SELECT * FROM equipment WHERE user_id = ?',
        [user.userId]
      );

      if (equipmentRows.length === 0) {
        await gameDb.query(
          'INSERT INTO equipment (user_id, created_at, updated_at) VALUES (?, UNIX_TIMESTAMP(), UNIX_TIMESTAMP())',
          [user.userId]
        );
      }

      const requestedSlot = item.equipment_slot;
      let slot = null;

      if (requestedSlot === 'ring') {
        const [equipRows] = await gameDb.query(
          'SELECT ring_left, ring_right FROM equipment WHERE user_id = ?',
          [user.userId]
        );

        const eq = equipRows && equipRows.length > 0 ? equipRows[0] : { ring_left: null, ring_right: null };

        if (!eq.ring_left || eq.ring_left === 0) {
          slot = 'ring_left';
        } else if (!eq.ring_right || eq.ring_right === 0) {
          slot = 'ring_right';
        } else {
          slot = 'ring_right';
        }
      } else {
        if (slotToDb.hasOwnProperty(requestedSlot)) {
          slot = slotToDb[requestedSlot];
        } else {
          slot = requestedSlot;
        }
      }

      const [currentEquip] = await gameDb.query(
        `SELECT ${slot} FROM equipment WHERE user_id = ?`,
        [user.userId]
      );

      const previousInventoryId = currentEquip[0][slot];

      await gameDb.query(
        `UPDATE equipment SET ${slot} = ?, updated_at = UNIX_TIMESTAMP() WHERE user_id = ?`,
        [inventoryId, user.userId]
      );

      // Invalidate cached walk_speed since equipment changed
      await invalidateWalkSpeed(user.userId);

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

      // Play equip sound
      const settings = socket.user && socket.user.settings;
      if (settings && settings.soundsEnabled) {
        const volume = typeof settings.soundVolume === 'number' 
          ? settings.soundVolume 
          : parseFloat(settings.soundVolume) || 1.0;
        socket.emit('audio:play', {
          type: 'sfx',
          file: 'equip-armor.ogg',
          volume: volume,
          loop: false
        });
      }

      // Emit updated player stats
      try {
        const updatedState = await buildPlayerState(user.userId);
        if (updatedState) socket.emit('player:state', updatedState);
      } catch (err) {
        logger.error('Failed to emit updated player state after equip', { error: err.message, userId: user.userId });
      }

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
      const [equipmentRows] = await gameDb.query(
        `SELECT ${slot} FROM equipment WHERE user_id = ?`,
        [user.userId]
      );

      if (equipmentRows.length === 0 || !equipmentRows[0][slot]) {
        if (callback) callback({ success: false, error: 'No item equipped in that slot' });
        return;
      }

      const inventoryId = equipmentRows[0][slot];

      const [itemRows] = await gameDb.query(
        `SELECT i.name FROM inventory inv
         JOIN items i ON inv.item_id = i.item_id
         WHERE inv.inventory_id = ?`,
        [inventoryId]
      );

      await gameDb.query(
        `UPDATE equipment SET ${slot} = NULL, updated_at = UNIX_TIMESTAMP() WHERE user_id = ?`,
        [user.userId]
      );

      // Invalidate cached walk_speed since equipment changed
      await invalidateWalkSpeed(user.userId);

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

      try {
        const updatedState = await buildPlayerState(user.userId);
        if (updatedState) socket.emit('player:state', updatedState);
      } catch (err) {
        logger.error('Failed to emit updated player state after unequip', { error: err.message, userId: user.userId });
      }

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

      const { resolveLootTable } = require('../queues/walkerQueue');
      const rewards = await resolveLootTable(lootTableKey);

      if (rewards.length === 0) {
        await addPlayerLog(user.userId, 'No rewards found', 'error', io);
        if (callback) callback({ success: true, message: 'Box opened', rewards: [] });
        return;
      }

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

      const { addToInventory } = require('../queues/walkerQueue');
      const rewardItems = [];

      for (const reward of rewards) {
        await addToInventory(user.userId, reward.itemId, reward.quantity);

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

      const userSocket = getUserSocket(user.userId);
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
}

module.exports = { registerInventoryHandlers, slotToDb, dbToSlot };
