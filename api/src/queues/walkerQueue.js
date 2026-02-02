const Bull = require('bull');
const { redis, gameDb } = require('../config/database');
const { QUEUE_INTERVALS, BULL_JOB_OPTIONS } = require('../config/constants');
const logger = require('../config/logger');

let io = null; // Socket.io instance, injected later
// Track last-known region id per user for walker-based movement
const userRegions = new Map();

/**
 * Simple point-in-polygon test (ray-casting)
 * polygon: array of [x,y] points
 */
function pointInPolygon(px, py, polygon) {
  if (!Array.isArray(polygon) || polygon.length === 0) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / (yj - yi + 0.0) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Set Socket.io instance for emitting events
 */
function setSocketIO(socketIO) {
  io = socketIO;
}

/**
 * Walker Queue - Processes walker movements every 2 seconds
 */
const walkerQueue = new Bull('walker-processor', {
  redis: {
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT || '6379')
  },
  defaultJobOptions: BULL_JOB_OPTIONS
});

walkerQueue.process('process-walkers', async (job) => {
  try {
    // Get all active walkers
    const [walkers] = await gameDb.query(
      `SELECT walker_id, user_id, positions, current_index, status
       FROM walkers
       WHERE status = 'walking'`
    );

    if (walkers.length === 0) {
      return { processed: 0 };
    }

    const now = Math.floor(Date.now() / 1000);
    let processed = 0;

    for (const walker of walkers) {
      const positions = typeof walker.positions === 'string' ?
        JSON.parse(walker.positions) : walker.positions;

      const nextIndex = walker.current_index + 1;

      if (nextIndex >= positions.length) {
        // Walker has reached destination
        await gameDb.query(
          `UPDATE walkers SET status = 'done', finished_at = ?, updated_at = ?
           WHERE walker_id = ?`,
          [now, now, walker.walker_id]
        );

        // Emit walker completed event
        if (io) {
          io.emit('walker:completed', {
            userId: walker.user_id,
            walkerId: walker.walker_id
          });
        }

        processed++;
        continue;
      }

      // Advance walker to next position
      const newPos = positions[nextIndex];
      await gameDb.query(
        `UPDATE walkers SET current_index = ?, updated_at = ?
         WHERE walker_id = ?`,
        [nextIndex, now, walker.walker_id]
      );

      // Update player position
      await gameDb.query(
        'UPDATE players SET x = ?, y = ?, last_active = UNIX_TIMESTAMP() WHERE user_id = ?',
        [newPos[0], newPos[1], walker.user_id]
      );

      // Emit walker step event to all clients (for player visibility)
      if (io) {
        io.emit('walker:step', {
          userId: walker.user_id,
          walkerId: walker.walker_id,
          currentIndex: nextIndex,
          position: { x: newPos[0], y: newPos[1] },
          totalSteps: positions.length,
          completed: false
        });

        // Also emit position update for real-time player tracking
        io.emit('players:position', [{
          userId: walker.user_id,
          x: newPos[0],
          y: newPos[1]
        }]);

        // Handle region change for this user (walker moved)
        try {
          const regions = require('../../gameData/regions.json');
          const prevRegionId = userRegions.get(walker.user_id) || null;
          const matched = regions.find(r => Array.isArray(r.coordinates) && pointInPolygon(newPos[0], newPos[1], r.coordinates));
          const newRegionId = matched ? (matched.id || null) : null;

          if (newRegionId !== prevRegionId) {
            userRegions.set(walker.user_id, newRegionId);

            // Find the socket for this user (if connected)
            let targetSocket = null;
            try {
              const sockets = io.sockets && io.sockets.sockets ? Array.from(io.sockets.sockets.values()) : [];
              for (const s of sockets) {
                if (s && s.user && s.user.userId === walker.user_id) {
                  targetSocket = s;
                  break;
                }
              }
            } catch (e) {
              targetSocket = null;
            }

            if (targetSocket) {
              // Always request stop for previous music to be safe
              if (prevRegionId) {
                try { targetSocket.emit('audio:stop', { type: 'music', regionId: prevRegionId }); } catch (e) {}
              }

              // Play new music only if user enabled music
              try {
                const settings = targetSocket.user && targetSocket.user.settings ? targetSocket.user.settings : null;
                if (matched && matched.music && settings && settings.musicEnabled) {
                  const vol = typeof settings.musicVolume === 'number' ? settings.musicVolume : parseFloat(settings.musicVolume) || 0.6;
                  targetSocket.emit('audio:play', {
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
          logger.error('Failed to handle region change for walker', { error: e && e.message ? e.message : String(e), userId: walker.user_id });
        }
      }

      processed++;
    }

    return { processed };

  } catch (error) {
    logger.error('Walker queue error', { error: error.message });
    throw error;
  }
});

walkerQueue.on('completed', (job, result) => {
  logger.debug('Walker queue completed', result);
});

walkerQueue.on('failed', (job, err) => {
  logger.error('Walker queue failed', { error: err.message });
});

/**
 * Initialize walker queue with repeatable job
 */
async function initWalkerQueue() {
  await walkerQueue.add(
    'process-walkers',
    {},
    {
      repeat: {
        every: QUEUE_INTERVALS.WALKER
      },
      ...BULL_JOB_OPTIONS
    }
  );
  logger.info('Walker queue initialized', { interval: `${QUEUE_INTERVALS.WALKER}ms` });
}

module.exports = {
  walkerQueue,
  initWalkerQueue,
  setSocketIO
};
