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

    const payload = territories.map(t => ({
      territoryId: t.territory_id,
      realm: t.realm,
      name: t.name,
      type: t.type,
      health: t.health,
      maxHealth: t.max_health,
      x: t.x,
      y: t.y,
      ownerRealm: t.owner_realm,
      ownerPlayers: t.owner_players,
      contested: !!t.contested,
      contestedSince: t.contested_since,
      iconName: t.icon_name,
      iconNameContested: t.icon_name_contested
    }));

    res.json({ territories: payload });

  } catch (error) {
    logger.error('Failed to get territories', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
