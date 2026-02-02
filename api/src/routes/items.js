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

    // Parse stats JSON
    const parsedItems = items.map(item => ({
      ...item,
      stats: typeof item.stats === 'string' ? JSON.parse(item.stats) : item.stats
    }));

    res.json({ items: parsedItems });

  } catch (error) {
    logger.error('Failed to get items', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
