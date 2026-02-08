const { walkerQueue, initWalkerQueue, setSocketIO: setWalkerIO } = require('./walkerQueue');
const { healthQueue, initHealthQueue, setSocketIO: setHealthIO } = require('./healthQueue');
const { spellQueue, initSpellQueue, setSocketIO: setSpellIO } = require('./spellQueue');
const { timeQueue, initTimeQueue, setSocketIO: setTimeIO } = require('./timeQueue');
const { territoryQueue, initTerritoryQueue, setSocketIO: setTerritoryIO } = require('./territoryQueue');
const { initSpawnQueue } = require('./spawnQueue');
const logger = require('../config/logger');

let spawnQueue = null;

/**
 * Initialize all Bull queues with Socket.io instance
 */
async function initializeQueues(io) {
  logger.info('Initializing Bull queues...');

  // Set Socket.io instance for all queues
  setWalkerIO(io);
  setHealthIO(io);
  setSpellIO(io);
  setTimeIO(io);
  setTerritoryIO(io);

  // Initialize repeatable jobs
  await initWalkerQueue();
  await initHealthQueue();
  await initSpellQueue();
  await initTimeQueue();
  await initTerritoryQueue();
  spawnQueue = initSpawnQueue(io);

  logger.info('All queues initialized successfully');
}

/**
 * Clean up queues on shutdown
 */
async function closeQueues() {
  logger.info('Closing Bull queues...');
  
  await walkerQueue.close();
  await healthQueue.close();
  await spellQueue.close();
  await timeQueue.close();
  await territoryQueue.close();
  if (spawnQueue) await spawnQueue.close();

  logger.info('All queues closed');
}

module.exports = {
  walkerQueue,
  healthQueue,
  spellQueue,
  timeQueue,
  territoryQueue,
  spawnQueue,
  initializeQueues,
  closeQueues
};
