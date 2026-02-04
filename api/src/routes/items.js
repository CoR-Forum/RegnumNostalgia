const express = require('express');
const router = express.Router();
const { gameDb } = require('../config/database');
const { optionalAuth } = require('../middleware/auth');
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

module.exports = router;
