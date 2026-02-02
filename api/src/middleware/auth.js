const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/constants');
const { gameDb } = require('../config/database');
const logger = require('../config/logger');

/**
 * Express middleware to verify JWT token from X-Session-Token header
 */
async function authenticateJWT(req, res, next) {
  const token = req.headers['x-session-token'];

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { userId, username, realm }

    // Update last_active timestamp
    await gameDb.query(
      'UPDATE players SET last_active = UNIX_TIMESTAMP() WHERE user_id = ?',
      [decoded.userId]
    );

    next();
  } catch (error) {
    logger.error('JWT verification failed', { error: error.message });
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Socket.io middleware to verify JWT token from handshake auth
 */
async function authenticateSocket(socket, next) {
  const token = socket.handshake.auth.token;

  if (!token) {
    return next(new Error('Authentication required'));
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Fetch realm from database
    const [playerRows] = await gameDb.query(
      'SELECT realm FROM players WHERE user_id = ?',
      [decoded.userId]
    );
    
    const realm = playerRows.length > 0 ? playerRows[0].realm : null;
    
    // Load user settings (if present)
    let settings = {
      musicEnabled: 1,
      musicVolume: 0.6,
      soundsEnabled: 1,
      soundVolume: 1.0,
      captureSoundsEnabled: 1,
      captureSoundsVolume: 1.0,
      mapVersion: 'v1'
    };

    try {
      const [rows] = await gameDb.query('SELECT music_enabled, music_volume, sounds_enabled, sound_volume, capture_sounds_enabled, capture_sounds_volume, map_version FROM user_settings WHERE user_id = ?', [decoded.userId]);
      if (rows && rows.length > 0) {
        settings = {
          musicEnabled: rows[0].music_enabled === 1 ? 1 : 0,
          musicVolume: typeof rows[0].music_volume === 'number' ? rows[0].music_volume : parseFloat(rows[0].music_volume) || 0.6,
          soundsEnabled: rows[0].sounds_enabled === 1 ? 1 : 0,
          soundVolume: typeof rows[0].sound_volume === 'number' ? rows[0].sound_volume : parseFloat(rows[0].sound_volume) || 1.0,
          captureSoundsEnabled: rows[0].capture_sounds_enabled === 1 ? 1 : 0,
          captureSoundsVolume: typeof rows[0].capture_sounds_volume === 'number' ? rows[0].capture_sounds_volume : parseFloat(rows[0].capture_sounds_volume) || 1.0,
          mapVersion: rows[0].map_version || 'v1'
        };
      }
    } catch (e) {
      logger.error('Failed to load user settings during socket auth', { error: e && e.message ? e.message : String(e), userId: decoded.userId });
    }

    socket.user = { ...decoded, realm, settings }; // { userId, username, realm, settings }
    next();
  } catch (error) {
    logger.error('Socket JWT verification failed', { error: error.message });
    next(new Error('Invalid or expired token'));
  }
}

/**
 * Optional authentication - doesn't fail if no token
 */
function optionalAuth(req, res, next) {
  const token = req.headers['x-session-token'];

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
    } catch (error) {
      // Token invalid, but we don't fail - just continue without user
      logger.debug('Optional auth: Invalid token provided');
    }
  }

  next();
}

module.exports = {
  authenticateJWT,
  authenticateSocket,
  optionalAuth
};
