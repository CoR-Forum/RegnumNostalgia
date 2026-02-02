const express = require('express');
const router = express.Router();
const { gameDb } = require('../config/database');
const { authenticateJWT } = require('../middleware/auth');
const logger = require('../config/logger');

/**
 * GET /equipment
 * Returns all 10 equipment slots with item details
 */
router.get('/', authenticateJWT, async (req, res) => {
  try {
    const [equipmentRows] = await gameDb.query(
      'SELECT * FROM equipment WHERE user_id = ?',
      [req.user.userId]
    );

    if (equipmentRows.length === 0) {
      // Create equipment row if it doesn't exist
      await gameDb.query(
        'INSERT INTO equipment (user_id, created_at, updated_at) VALUES (?, UNIX_TIMESTAMP(), UNIX_TIMESTAMP())',
        [req.user.userId]
      );

      return res.json({
        equipment: {
          head: null,
          body: null,
          hands: null,
          shoulders: null,
          legs: null,
          weapon_right: null,
          weapon_left: null,
          ring_right: null,
          ring_left: null,
          amulet: null
        }
      });
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
      const [itemRows] = await gameDb.query(
        `SELECT inv.inventory_id, i.template_key, i.name, i.type, i.description, 
                i.stats, i.rarity, i.level, i.equipment_slot, i.icon_name
         FROM inventory inv
         JOIN items i ON inv.item_id = i.item_id
         WHERE inv.inventory_id IN (?)`,
        [equippedIds]
      );

      itemRows.forEach(item => {
        itemDetails[item.inventory_id] = {
          ...item,
          stats: typeof item.stats === 'string' ? JSON.parse(item.stats) : item.stats
        };
      });
    }

    // Build equipment response
    const equippedItems = {};
    slots.forEach(slot => {
      const invId = equipment[slot];
      equippedItems[slot] = invId && itemDetails[invId] ? itemDetails[invId] : null;
    });

    res.json({ equipment: equippedItems });

  } catch (error) {
    logger.error('Failed to get equipment', { 
      error: error.message, 
      userId: req.user.userId 
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /equipment/equip
 * Equips an item from inventory
 */
router.post('/equip', authenticateJWT, async (req, res) => {
  const { inventoryId } = req.body;

  if (!inventoryId) {
    return res.status(400).json({ error: 'Inventory ID required' });
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
      return res.status(404).json({ error: 'Item not found' });
    }

    const item = invRows[0];

    // Verify ownership
    if (item.user_id !== req.user.userId) {
      return res.status(403).json({ error: 'Not your item' });
    }

    // Check if item can be equipped
    if (!item.equipment_slot) {
      return res.status(400).json({ error: 'Item cannot be equipped' });
    }

    // Get player level
    const [playerRows] = await gameDb.query(
      'SELECT level FROM players WHERE user_id = ?',
      [req.user.userId]
    );

    if (playerRows.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }

    // Check level requirement
    if (item.level > playerRows[0].level) {
      return res.status(400).json({ 
        error: `Level ${item.level} required to equip this item` 
      });
    }

    // Get current equipment
    const [equipmentRows] = await gameDb.query(
      'SELECT * FROM equipment WHERE user_id = ?',
      [req.user.userId]
    );

    if (equipmentRows.length === 0) {
      // Create equipment row
      await gameDb.query(
        'INSERT INTO equipment (user_id) VALUES (?)',
        [req.user.userId]
      );
    }

    const slot = item.equipment_slot;

    // Check if slot is already occupied
    const [currentEquip] = await gameDb.query(
      `SELECT ${slot} FROM equipment WHERE user_id = ?`,
      [req.user.userId]
    );

    const previousInventoryId = currentEquip[0][slot];

    // Equip the item
    await gameDb.query(
      `UPDATE equipment SET ${slot} = ?, updated_at = UNIX_TIMESTAMP() WHERE user_id = ?`,
      [inventoryId, req.user.userId]
    );

    logger.info('Item equipped', { 
      userId: req.user.userId, 
      inventoryId, 
      slot,
      previousInventoryId
    });

    res.json({ 
      success: true, 
      slot,
      equippedInventoryId: inventoryId,
      unequippedInventoryId: previousInventoryId > 0 ? previousInventoryId : null
    });

  } catch (error) {
    logger.error('Failed to equip item', { 
      error: error.message, 
      userId: req.user.userId,
      inventoryId
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /equipment/unequip
 * Unequips an item from a slot
 */
router.post('/unequip', authenticateJWT, async (req, res) => {
  const { slot } = req.body;

  const validSlots = ['head', 'body', 'hands', 'shoulders', 'legs', 
                      'weapon_right', 'weapon_left', 'ring_right', 'ring_left', 'amulet'];

  if (!slot || !validSlots.includes(slot)) {
    return res.status(400).json({ error: 'Invalid equipment slot' });
  }

  try {
    // Get current equipped item
    const [equipmentRows] = await gameDb.query(
      `SELECT ${slot} FROM equipment WHERE user_id = ?`,
      [req.user.userId]
    );

    if (equipmentRows.length === 0 || !equipmentRows[0][slot]) {
      return res.status(400).json({ error: 'No item equipped in that slot' });
    }

    const inventoryId = equipmentRows[0][slot];

    // Unequip the item
    await gameDb.query(
      `UPDATE equipment SET ${slot} = NULL, updated_at = UNIX_TIMESTAMP() WHERE user_id = ?`,
      [req.user.userId]
    );

    logger.info('Item unequipped', { 
      userId: req.user.userId, 
      inventoryId, 
      slot 
    });

    res.json({ 
      success: true, 
      slot,
      unequippedInventoryId: inventoryId
    });

  } catch (error) {
    logger.error('Failed to unequip item', { 
      error: error.message, 
      userId: req.user.userId,
      slot
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
