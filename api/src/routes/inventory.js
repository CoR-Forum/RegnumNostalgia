const express = require('express');
const router = express.Router();
const { gameDb } = require('../config/database');
const { authenticateJWT } = require('../middleware/auth');
const logger = require('../config/logger');

/**
 * GET /inventory
 * Returns all items in player's inventory (excluding equipped items)
 */
router.get('/', authenticateJWT, async (req, res) => {
  try {
    // Get equipped inventory IDs to exclude them
    const [equipmentRows] = await gameDb.query(
      'SELECT head, body, hands, shoulders, legs, weapon_right, weapon_left, ring_right, ring_left, amulet FROM equipment WHERE user_id = ?',
      [req.user.userId]
    );

    const equippedIds = equipmentRows.length > 0 ? 
      Object.values(equipmentRows[0]).filter(id => id > 0) : [];

    // Get inventory items
    let query = `
      SELECT inv.inventory_id, inv.item_id, inv.quantity, inv.acquired_at,
             i.template_key, i.name, i.type, i.description, i.stats, 
             i.rarity, i.stackable, i.level, i.equipment_slot, i.icon_name
      FROM inventory inv
      JOIN items i ON inv.item_id = i.item_id
      WHERE inv.user_id = ?
    `;
    
    const params = [req.user.userId];

    if (equippedIds.length > 0) {
      query += ' AND inv.inventory_id NOT IN (?)';
      params.push(equippedIds);
    }

    query += ' ORDER BY inv.acquired_at DESC';

    const [items] = await gameDb.query(query, params);

    // Parse stats JSON
    const inventory = items.map(item => ({
      ...item,
      stats: typeof item.stats === 'string' ? JSON.parse(item.stats) : item.stats
    }));

    res.json({ items: inventory });

  } catch (error) {
    logger.error('Failed to get inventory', { 
      error: error.message, 
      userId: req.user.userId 
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /inventory/add
 * Adds an item to player's inventory (with stacking support)
 */
router.post('/add', authenticateJWT, async (req, res) => {
  const { itemId, quantity = 1 } = req.body;

  if (!itemId || quantity < 1) {
    return res.status(400).json({ error: 'Invalid item or quantity' });
  }

  try {
    // Get item details
    const [itemRows] = await gameDb.query(
      'SELECT item_id, template_key, stackable FROM items WHERE item_id = ?',
      [itemId]
    );

    if (itemRows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const item = itemRows[0];

    // Check if item is stackable and player already has it
    if (item.stackable) {
      const [existingRows] = await gameDb.query(
        'SELECT inventory_id, quantity FROM inventory WHERE user_id = ? AND item_id = ?',
        [req.user.userId, itemId]
      );

      if (existingRows.length > 0) {
        // Stack with existing item
        const newQuantity = existingRows[0].quantity + quantity;
        await gameDb.query(
          'UPDATE inventory SET quantity = ? WHERE inventory_id = ?',
          [newQuantity, existingRows[0].inventory_id]
        );

        return res.json({ 
          success: true, 
          inventoryId: existingRows[0].inventory_id,
          stacked: true,
          quantity: newQuantity
        });
      }
    }

    // Add new inventory entry
    const [result] = await gameDb.query(
      'INSERT INTO inventory (user_id, item_id, quantity, acquired_at) VALUES (?, ?, ?, NOW())',
      [req.user.userId, itemId, quantity]
    );

    res.json({ 
      success: true, 
      inventoryId: result.insertId,
      stacked: false,
      quantity
    });

  } catch (error) {
    logger.error('Failed to add item to inventory', { 
      error: error.message, 
      userId: req.user.userId,
      itemId,
      quantity
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /inventory/remove
 * Removes an item from inventory or decreases quantity
 */
router.post('/remove', authenticateJWT, async (req, res) => {
  const { inventoryId, quantity = 1 } = req.body;

  if (!inventoryId || quantity < 1) {
    return res.status(400).json({ error: 'Invalid inventory ID or quantity' });
  }

  try {
    // Get current inventory item
    const [invRows] = await gameDb.query(
      'SELECT inventory_id, quantity FROM inventory WHERE inventory_id = ? AND user_id = ?',
      [inventoryId, req.user.userId]
    );

    if (invRows.length === 0) {
      return res.status(404).json({ error: 'Item not found in inventory' });
    }

    const currentQuantity = invRows[0].quantity;

    if (quantity >= currentQuantity) {
      // Remove entire stack
      await gameDb.query(
        'DELETE FROM inventory WHERE inventory_id = ?',
        [inventoryId]
      );

      return res.json({ 
        success: true, 
        removed: true,
        remainingQuantity: 0
      });
    } else {
      // Decrease quantity
      const newQuantity = currentQuantity - quantity;
      await gameDb.query(
        'UPDATE inventory SET quantity = ? WHERE inventory_id = ?',
        [newQuantity, inventoryId]
      );

      return res.json({ 
        success: true, 
        removed: false,
        remainingQuantity: newQuantity
      });
    }

  } catch (error) {
    logger.error('Failed to remove item from inventory', { 
      error: error.message, 
      userId: req.user.userId,
      inventoryId,
      quantity
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
