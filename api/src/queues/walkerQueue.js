const Bull = require('bull');
const { redis, gameDb } = require('../config/database');
const { QUEUE_INTERVALS, BULL_JOB_OPTIONS } = require('../config/constants');
const logger = require('../config/logger');

let io = null; // Socket.io instance, injected later

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
