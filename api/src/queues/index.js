const { walkerQueue, initWalkerQueue, setSocketIO: setWalkerIO } = require('./walkerQueue');
const { healthQueue, initHealthQueue, setSocketIO: setHealthIO } = require('./healthQueue');
const { timeQueue, initTimeQueue, setSocketIO: setTimeIO } = require('./timeQueue');
const { territoryQueue, initTerritoryQueue, setSocketIO: setTerritoryIO } = require('./territoryQueue');
const logger = require('../config/logger');

/**
 * Initialize all Bull queues with Socket.io instance
 */
async function initializeQueues(io) {
  logger.info('Initializing Bull queues...');

  // Set Socket.io instance for all queues
  setWalkerIO(io);
  setHealthIO(io);
  setTimeIO(io);
  setTerritoryIO(io);

  // Initialize repeatable jobs
  await initWalkerQueue();
  await initHealthQueue();
  await initTimeQueue();
  await initTerritoryQueue();

  logger.info('All queues initialized successfully');
}

/**
 * Clean up queues on shutdown
 */
async function closeQueues() {
  logger.info('Closing Bull queues...');
  
  await walkerQueue.close();
  await healthQueue.close();
  await timeQueue.close();
  await territoryQueue.close();

  logger.info('All queues closed');
}

module.exports = {
  walkerQueue,
  healthQueue,
  timeQueue,
  territoryQueue,
  initializeQueues,
  closeQueues
};
