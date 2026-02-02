const express = require('express');
const router = express.Router();
const { gameDb } = require('../config/database');
const { authenticateJWT } = require('../middleware/auth');
const logger = require('../config/logger');

/**
 * GET /superbosses
 * Returns all superbosses with health and positions
 */
router.get('/', authenticateJWT, async (req, res) => {
  try {
    const [superbosses] = await gameDb.query(
      `SELECT boss_id, name, icon_name, health, max_health, x, y,
              last_attacked, respawn_time
       FROM superbosses
       ORDER BY boss_id`
    );

    res.json({ superbosses });

  } catch (error) {
    logger.error('Failed to get superbosses', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
