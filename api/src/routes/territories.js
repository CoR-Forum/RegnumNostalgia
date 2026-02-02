const express = require('express');
const router = express.Router();
const { gameDb } = require('../config/database');
const { authenticateJWT } = require('../middleware/auth');
const logger = require('../config/logger');

/**
 * GET /territories
 * Returns all forts/castles/walls with health, ownership, and contested status
 */
router.get('/', authenticateJWT, async (req, res) => {
  try {
    const [territories] = await gameDb.query(
      `SELECT territory_id, realm, name, type, health, max_health, x, y,
              owner_realm, owner_players, contested, contested_since,
              icon_name, icon_name_contested
       FROM territories
       ORDER BY territory_id`
    );

    res.json({ territories });

  } catch (error) {
    logger.error('Failed to get territories', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
