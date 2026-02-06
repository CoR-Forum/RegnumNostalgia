const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { gameDb, forumDb } = require('../config/database');
const { 
  FORUM_API_URL, 
  FORUM_API_KEY, 
  JWT_SECRET, 
  JWT_EXPIRES_IN,
  SPAWN_COORDS,
  STARTER_ITEMS
} = require('../config/constants');
const logger = require('../config/logger');

/**
 * POST /login
 * Authenticates user against cor-forum API and forum database
 */
router.post('/', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  try {
    // Step 1: Validate credentials against forum API
    const params = new URLSearchParams();
    params.append('username', username);
    params.append('password', password);

    const response = await axios.post(
      `${FORUM_API_URL}/login`,
      params,
      {
        headers: {
          'X-API-KEY': FORUM_API_KEY,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    if (!response.data || !response.data.userID) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const userId = response.data.userID;

    // Step 2: Check activation status (must be in group 3)
    const [activationRows] = await forumDb.query(
      'SELECT groupID FROM wcf1_user_to_group WHERE userID = ? AND groupID = 3',
      [userId]
    );

    if (activationRows.length === 0) {
      return res.status(403).json({ error: 'Account not activated' });
    }

    // Step 3: Check ban status
    const [userRows] = await forumDb.query(
      'SELECT banned FROM wcf1_user WHERE userID = ?',
      [userId]
    );

    if (userRows.length === 0 || userRows[0].banned !== 0) {
      return res.status(403).json({ error: 'Account is banned' });
    }

    // Step 4: Get or create player in game database
    const [existingPlayer] = await gameDb.query(
      'SELECT user_id, username, realm FROM players WHERE user_id = ?',
      [userId]
    );

    let realm = null;

    if (existingPlayer.length === 0) {
      // Create new player (realm will be null until selected)
      await gameDb.query(
        `INSERT INTO players (user_id, username, realm, x, y, health, max_health, mana, max_mana, 
         xp, level, intelligence, dexterity, concentration, strength, constitution, last_active)
         VALUES (?, ?, NULL, 0, 0, 100, 100, 50, 50, 0, 1, 10, 10, 10, 10, 10, UNIX_TIMESTAMP())`,
        [userId, username]
      );

      // Create default user settings
      await gameDb.query(
        `INSERT INTO user_settings (user_id, music_enabled, music_volume, sounds_enabled, sound_volume, capture_sounds_enabled, capture_sounds_volume, collection_sounds_enabled, collection_sounds_volume, map_version, updated_at)
         VALUES (?, 1, 0.5, 1, 0.75, 1, 0.75, 1, 1.0, 'v1', UNIX_TIMESTAMP())`,
        [userId]
      );

      logger.info('Created new player', { userId, username });
    } else {
      realm = existingPlayer[0].realm;
      
      // Update last_active
      await gameDb.query(
        'UPDATE players SET last_active = UNIX_TIMESTAMP() WHERE user_id = ?',
        [userId]
      );
    }

    // Step 5: Generate JWT token (realm not included, fetched from DB when needed)
    const token = jwt.sign(
      { userId, username },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Step 6: Store session in database
    const sessionId = require('crypto').randomBytes(32).toString('hex');
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + (24 * 60 * 60); // 24 hours

    await gameDb.query(
      `INSERT INTO sessions (session_id, user_id, username, realm, created_at, expires_at, last_activity, fingerprint)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE last_activity = VALUES(last_activity), expires_at = VALUES(expires_at)`,
      [sessionId, userId, username, realm, now, expiresAt, now, req.headers['user-agent'] || null]
    );

    logger.info('User logged in', { userId, username, realm });

    res.json({
      sessionToken: token,
      userId,
      username,
      realm,
      needsRealmSelection: realm === null
    });

  } catch (error) {
    logger.error('Login failed', { error: error.message, username });
    
    if (error.response) {
      // External API error
      return res.status(error.response.status).json({ 
        error: error.response.data?.error || 'Authentication failed' 
      });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /realm/select
 * One-time realm selection for new players
 */
router.post('/select', async (req, res) => {
  const token = req.headers['x-session-token'];
  
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { realm } = req.body;

    if (!realm || !['syrtis', 'alsius', 'ignis'].includes(realm.toLowerCase())) {
      return res.status(400).json({ error: 'Invalid realm. Must be syrtis, alsius, or ignis' });
    }

    const realmLower = realm.toLowerCase();

    // Check if player has already selected a realm
    const [player] = await gameDb.query(
      'SELECT realm FROM players WHERE user_id = ?',
      [decoded.userId]
    );

    if (player.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }

    if (player[0].realm !== null) {
      return res.status(400).json({ error: 'Realm already selected' });
    }

    // Get spawn coordinates
    const spawnCoords = SPAWN_COORDS[realmLower];

    // Update player with realm and spawn position
    await gameDb.query(
      'UPDATE players SET realm = ?, x = ?, y = ? WHERE user_id = ?',
      [realmLower, spawnCoords.x, spawnCoords.y, decoded.userId]
    );

    // Grant starter items
    for (const starterItem of STARTER_ITEMS) {
      // Get item_id and stackable from template_key
      const [itemRows] = await gameDb.query(
        'SELECT item_id, stackable FROM items WHERE template_key = ?',
        [starterItem.template_key]
      );

      if (itemRows.length > 0) {
        const itemId = itemRows[0].item_id;
        const isStackable = itemRows[0].stackable;

        if (!isStackable && starterItem.quantity > 1) {
          // For non-stackable items with quantity > 1, add multiple entries
          for (let i = 0; i < starterItem.quantity; i++) {
            await gameDb.query(
              'INSERT INTO inventory (user_id, item_id, quantity, acquired_at) VALUES (?, ?, 1, UNIX_TIMESTAMP())',
              [decoded.userId, itemId]
            );
          }
        } else {
          // Stackable or quantity 1
          await gameDb.query(
            'INSERT INTO inventory (user_id, item_id, quantity, acquired_at) VALUES (?, ?, ?, UNIX_TIMESTAMP())',
            [decoded.userId, itemId, starterItem.quantity]
          );
        }
      }
    }

    // Create equipment row for player
    await gameDb.query(
      'INSERT INTO equipment (user_id, created_at, updated_at) VALUES (?, UNIX_TIMESTAMP(), UNIX_TIMESTAMP()) ON DUPLICATE KEY UPDATE updated_at = UNIX_TIMESTAMP()',
      [decoded.userId]
    );

    // Realm is now in database, no need to update token
    const newToken = jwt.sign(
      { userId: decoded.userId, username: decoded.username },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    logger.info('Player selected realm', { 
      userId: decoded.userId, 
      username: decoded.username, 
      realm: realmLower 
    });

    res.json({
      success: true,
      sessionToken: newToken,
      realm: realmLower,
      spawnX: spawnCoords.x,
      spawnY: spawnCoords.y
    });

  } catch (error) {
    logger.error('Realm selection failed', { error: error.message });
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(403).json({ error: 'Invalid token' });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
