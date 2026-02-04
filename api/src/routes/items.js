const express = require('express');
const router = express.Router();
const { gameDb } = require('../config/database');
const { optionalAuth, authenticateJWT } = require('../middleware/auth');
const { collectItem, getSpawnedItems } = require('../services/spawn');
const logger = require('../config/logger');

/**
 * GET /items
 * Returns all item templates
 */
router.get('/', optionalAuth, async (req, res) => {
  try {
    const [items] = await gameDb.query(
      `SELECT item_id, template_key, name, type, description, stats, 
              rarity, stackable, level, equipment_slot, icon_name
       FROM items
       ORDER BY type, level, name`
    );

    // Parse stats JSON and normalize keys to camelCase
    const parsedItems = items.map(item => ({
      itemId: item.item_id,
      templateKey: item.template_key,
      name: item.name,
      type: item.type,
      description: item.description,
      stats: typeof item.stats === 'string' ? JSON.parse(item.stats) : item.stats,
      rarity: item.rarity,
      stackable: !!item.stackable,
      level: item.level,
      equipmentSlot: item.equipment_slot,
      iconName: item.icon_name
    }));

    res.json({ items: parsedItems });

  } catch (error) {
    logger.error('Failed to get items', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /items/spawned
 * Returns spawned collectable items for the player's realm
 */
router.get('/spawned', authenticateJWT, async (req, res) => {
  try {
    const { getSpawnedItems } = require('../services/spawn');
    const spawnedItems = await getSpawnedItems(req.user.realm);
    res.json({ spawnedItems });
  } catch (error) {
    logger.error('Failed to get spawned items', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /items/collect
 * Collects a spawned item at the given coordinates
 */
router.post('/collect', authenticateJWT, async (req, res) => {
  const { x, y } = req.body;

  if (typeof x !== 'number' || typeof y !== 'number') {
    return res.status(400).json({ error: 'Invalid coordinates' });
  }

  try {
    const result = await collectItem(req.user.userId, x, y);
    const quantityText = result.quantity > 1 ? ` x${result.quantity}` : '';
    res.json({ success: true, message: `Collected ${result.item}${quantityText}`, item: result.template_key, quantity: result.quantity });
  } catch (error) {
    logger.error('Failed to collect item', { error: error.message, userId: req.user.userId, x, y });
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
