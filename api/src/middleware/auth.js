const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/constants');
const { gameDb } = require('../config/database');
const logger = require('../config/logger');
const { bufferLastActive, getCachedUserSettings } = require('../config/cache');

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

    // Buffer last_active update in Redis (flushed to DB every 5s)
    bufferLastActive(decoded.userId);

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
    
    if (playerRows.length === 0) {
      logger.warn('Socket auth failed: player not found in database', { userId: decoded.userId });
      return next(new Error('Player not found - please login again'));
    }

    const realm = playerRows[0].realm;
    
    // Load user settings from Redis cache (falls back to DB)
    let settings = {
      musicEnabled: 0,
      musicVolume: 0.20,
      soundsEnabled: 1,
      soundVolume: 1.0,
      captureSoundsEnabled: 1,
      captureSoundsVolume: 1.0,
      collectionSoundsEnabled: 1,
      collectionSoundsVolume: 1.0,
      mapVersion: 'v1-compressed'
    };

    try {
      const cached = await getCachedUserSettings(gameDb, decoded.userId);
      if (cached) settings = cached;
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
