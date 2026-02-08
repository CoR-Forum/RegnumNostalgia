const { gameDb } = require('../config/database');
const { findPath, createWalker } = require('../services/pathfinding');
const logger = require('../config/logger');

/**
 * Register collectable-related socket handlers.
 * @param {object} socket  - The connected socket instance
 * @param {object} user    - Authenticated user { userId, username, realm }
 * @param {object} io      - Socket.io server instance
 */
function registerCollectableHandlers(socket, user, io) {

  /**
   * Get spawned items for user's realm
   */
  socket.on('spawned-items:get', async (callback) => {
    try {
      const { COLLECTABLE_VISUAL_NAMES } = require('../config/constants');
      const [spawnedItems] = await gameDb.query(
        `SELECT spawn_id, x, y, visual_icon, realm, type
         FROM spawned_items
         WHERE (realm = ? OR realm = 'neutral') AND collected_at IS NULL`,
        [user.realm]
      );

      const spawnedItemsPayload = spawnedItems.map(si => ({
        spawnId: si.spawn_id,
        x: si.x,
        y: si.y,
        visualIcon: si.visual_icon,
        visualName: COLLECTABLE_VISUAL_NAMES[si.visual_icon] || 'Container',
        realm: si.realm,
        type: si.type
      }));

      if (callback) {
        callback({ success: true, spawnedItems: spawnedItemsPayload });
      } else {
        socket.emit('spawned-items:list', { spawnedItems: spawnedItemsPayload });
      }
    } catch (error) {
      logger.error('Failed to get spawned items', { error: error.message, userId: user.userId });
      if (callback) callback({ success: false, error: 'Failed to load spawned items' });
    }
  });

  /**
   * Handle collectable item click - initiate pathfinding to collect
   */
  socket.on('collectable:click', async (data, callback) => {
    try {
      const { spawnId } = data;

      if (!spawnId) {
        if (callback) callback({ success: false, error: 'Spawn ID required' });
        return;
      }

      const [spawns] = await gameDb.query(
        'SELECT spawn_id, x, y, realm, collected_at FROM spawned_items WHERE spawn_id = ?',
        [spawnId]
      );

      if (spawns.length === 0) {
        if (callback) callback({ success: false, error: 'Item not found' });
        return;
      }

      const spawn = spawns[0];

      if (spawn.collected_at !== null) {
        if (callback) callback({ success: false, error: 'Item already collected' });
        return;
      }

      if (spawn.realm !== 'neutral' && spawn.realm !== user.realm) {
        if (callback) callback({ success: false, error: 'Cannot collect items from other realms' });
        return;
      }

      try {
        const positions = await findPath(user.userId, spawn.x, spawn.y, user.realm);
        const walker = await createWalker(user.userId, positions, {
          collectingX: spawn.x,
          collectingY: spawn.y,
          collectingSpawnId: spawnId
        });

        io.emit('collectable:collecting', {
          spawnId: spawnId,
          userId: user.userId
        });

        if (callback) {
          callback({ success: true, walker });
        } else {
          socket.emit('move:started', walker);
        }

      } catch (pathError) {
        logger.error('Failed to calculate path to collectable', {
          error: pathError.message,
          userId: user.userId,
          spawnId
        });

        if (callback) {
          callback({ 
            success: false, 
            error: pathError.message.includes('cannot') || pathError.message.includes('swim') 
              ? pathError.message 
              : 'Failed to calculate path' 
          });
        }
      }

    } catch (error) {
      logger.error('Collectable click failed', { error: error.message, userId: user.userId });
      if (callback) callback({ success: false, error: 'Failed to process collection request' });
    }
  });
}

module.exports = { registerCollectableHandlers };
