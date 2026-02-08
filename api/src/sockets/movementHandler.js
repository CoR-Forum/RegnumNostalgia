const { gameDb } = require('../config/database');
const { findPath, createWalker } = require('../services/pathfinding');
const logger = require('../config/logger');
const { pointInPolygon } = require('../utils/geometry');

/**
 * Register movement-related socket handlers.
 * @param {object} socket      - The connected socket instance
 * @param {object} user        - Authenticated user { userId, username, realm }
 * @param {object} io          - Socket.io server instance
 * @param {object} deps        - Shared helpers { userRegions }
 */
function registerMovementHandlers(socket, user, io, deps) {
  const { userRegions } = deps;

  /**
   * Handle position updates from client
   */
  socket.on('position:update', async (data, callback) => {
    const { x, y } = data || {};

    if (typeof x !== 'number' || typeof y !== 'number') {
      const err = { message: 'Invalid coordinates' };
      if (callback) return callback({ success: false, error: err.message });
      return socket.emit('error', err);
    }

    try {
      await gameDb.query(
        'UPDATE players SET x = ?, y = ?, last_active = UNIX_TIMESTAMP() WHERE user_id = ?',
        [x, y, user.userId]
      );

      io.emit('players:position', [{
        userId: user.userId,
        username: user.username,
        x,
        y,
        realm: user.realm
      }]);

      // Check for region change and play/stop music for this player only
      try {
        const regions = require('../../gameData/regions.json');
        const prevRegionId = userRegions.get(user.userId) || null;
        const matched = regions.find(r => Array.isArray(r.coordinates) && pointInPolygon(x, y, r.coordinates));
        const newRegionId = matched ? (matched.id || null) : null;

        if (newRegionId !== prevRegionId) {
          userRegions.set(user.userId, newRegionId);

          if (prevRegionId) {
            socket.emit('audio:stop', { type: 'music', regionId: prevRegionId });
          }

          if (matched && matched.music) {
            try {
              const settings = socket.user && socket.user.settings ? socket.user.settings : null;
              if (settings && settings.musicEnabled) {
                const vol = typeof settings.musicVolume === 'number' ? settings.musicVolume : parseFloat(settings.musicVolume) || 0.6;
                socket.emit('audio:play', {
                  type: 'music',
                  file: matched.music,
                  volume: vol,
                  loop: true,
                  regionId: newRegionId
                });
              }
            } catch (e) {
              // ignore
            }
          }
        }
      } catch (e) {
        logger.error('Failed to handle region change on position update', { error: e && e.message ? e.message : String(e), userId: user.userId });
      }

      if (callback) callback({ success: true, x, y });

    } catch (error) {
      logger.error('Failed to update position', { 
        error: error.message,
        userId: user.userId 
      });
      if (callback) callback({ success: false, error: 'Failed to update position' });
    }
  });

  /**
   * Handle movement requests (pathfinding)
   */
  socket.on('move:request', async (data) => {
    const { x, y, collectableSpawnId } = data;

    if (typeof x !== 'number' || typeof y !== 'number') {
      return socket.emit('error', { message: 'Invalid coordinates' });
    }

    if (!user.realm) {
      return socket.emit('error', { message: 'Realm not selected' });
    }

    try {
      let collectingData = null;
      if (collectableSpawnId) {
        const [spawns] = await gameDb.query(
          'SELECT spawn_id, x, y, realm, collected_at FROM spawned_items WHERE spawn_id = ?',
          [collectableSpawnId]
        );

        if (spawns.length === 0 || spawns[0].collected_at !== null) {
          return socket.emit('error', { message: 'Item not available' });
        }

        const spawn = spawns[0];
        if (spawn.realm !== 'neutral' && spawn.realm !== user.realm) {
          return socket.emit('error', { message: 'Cannot collect items from other realms' });
        }

        collectingData = {
          collectingX: spawn.x,
          collectingY: spawn.y,
          collectingSpawnId: collectableSpawnId
        };

        io.emit('collectable:collecting', {
          spawnId: collectableSpawnId,
          userId: user.userId
        });
      }

      const positions = await findPath(user.userId, x, y, user.realm);
      const walker = await createWalker(user.userId, positions, collectingData);

      socket.emit('move:started', walker);

    } catch (error) {
      logger.error('Move request failed', {
        error: error.message,
        userId: user.userId,
        destination: { x, y }
      });

      socket.emit('error', { 
        message: error.message.includes('cannot') || error.message.includes('swim') 
          ? error.message 
          : 'Failed to calculate path' 
      });
    }
  });
}

module.exports = { registerMovementHandlers };
