const express = require('express');
const router = express.Router();
const { gameDb } = require('../config/database');
const { authenticateJWT } = require('../middleware/auth');
const { COORDINATE_BOUNDS, ONLINE_THRESHOLD_SECONDS } = require('../config/constants');
const logger = require('../config/logger');

/**
 * GET /player/position
 * Returns current player position, stats, and game state
 */
router.get('/position', authenticateJWT, async (req, res) => {
  try {
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
      [req.user.userId]
    );

    if (playerRows.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }

    const player = playerRows[0];

    // Calculate equipment bonuses
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

    // Calculate derived stats
    const baseDamage = player.strength * 0.5 + player.intelligence * 0.3;
    const baseArmor = player.constitution * 0.5 + player.dexterity * 0.3;

    // Check walker status
    const [walkerRows] = await gameDb.query(
      `SELECT walker_id, current_index, positions, status 
       FROM walkers 
       WHERE user_id = ? AND status = 'walking' 
       ORDER BY started_at DESC LIMIT 1`,
      [req.user.userId]
    );

    let walkerStatus = null;
    if (walkerRows.length > 0) {
      const walker = walkerRows[0];
      const positions = typeof walker.positions === 'string' ? 
        JSON.parse(walker.positions) : walker.positions;
      
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

    res.json({
      userId: player.user_id,
      username: player.username,
      realm: player.realm,
      position: {
        x: player.x,
        y: player.y
      },
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
    });

  } catch (error) {
    logger.error('Failed to get player position', { 
      error: error.message, 
      userId: req.user.userId 
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /player/position
 * Updates player position (with bounds validation)
 */
router.post('/position', authenticateJWT, async (req, res) => {
  const { x, y } = req.body;

  if (typeof x !== 'number' || typeof y !== 'number') {
    return res.status(400).json({ error: 'Invalid coordinates' });
  }

  // Validate bounds
  if (x < COORDINATE_BOUNDS.min || x > COORDINATE_BOUNDS.max ||
      y < COORDINATE_BOUNDS.min || y > COORDINATE_BOUNDS.max) {
    return res.status(400).json({ 
      error: `Coordinates must be between ${COORDINATE_BOUNDS.min} and ${COORDINATE_BOUNDS.max}` 
    });
  }

  try {
    await gameDb.query(
      'UPDATE players SET x = ?, y = ?, last_active = NOW() WHERE user_id = ?',
      [x, y, req.user.userId]
    );

    res.json({ success: true, x, y });

  } catch (error) {
    logger.error('Failed to update player position', { 
      error: error.message, 
      userId: req.user.userId,
      x, y
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /players/online
 * Returns all players active in the last 5 seconds
 */
router.get('/online', authenticateJWT, async (req, res) => {
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

    res.json({ players: playersPayload });

  } catch (error) {
    logger.error('Failed to get online players', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
