const Bull = require('bull');
const { spawnItems } = require('../services/spawn');
const { QUEUE_INTERVALS, BULL_JOB_OPTIONS } = require('../config/constants');
const logger = require('../config/logger');

let io = null;

function setSocketIO(socketIO) {
  io = socketIO;
}

/**
 * Spawn Queue - Spawns collectable items every 2 seconds
 */
const spawnQueue = new Bull('spawn-items', {
  redis: {
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT || '6379')
  },
  defaultJobOptions: BULL_JOB_OPTIONS
});

spawnQueue.process('spawn-collectables', async (job) => {
  try {
    const spawnedItems = await spawnItems();
    logger.info('Collectable items spawned', { count: spawnedItems.length });
    
    // Emit spawned items update to all connected clients
    if (io && spawnedItems.length > 0) {
      // Group by realm and emit to clients in that realm
      const realmGroups = {};
      spawnedItems.forEach(item => {
        if (!realmGroups[item.realm]) realmGroups[item.realm] = [];
        realmGroups[item.realm].push({
          x: item.x,
          y: item.y,
          templateKey: item.template_key,
          iconName: item.icon_name,
          name: item.name
        });
      });

      // Emit to all clients in each realm
      for (const [realm, items] of Object.entries(realmGroups)) {
        io.emit('spawned-items:spawned', { realm, items });
      }
    }
  } catch (error) {
    logger.error('Failed to spawn collectable items', { error: error.message });
    throw error;
  }
});

async function initSpawnQueue() {
  // Spawn items every 2 seconds
  await spawnQueue.add('spawn-collectables', {}, {
    repeat: { every: 2000 }, // 2 seconds
    jobId: 'spawn-collectables-repeat'
  });

  logger.info('Spawn queue initialized - spawning every 2 seconds');
}

module.exports = {
  spawnQueue,
  initSpawnQueue,
  setSocketIO
};