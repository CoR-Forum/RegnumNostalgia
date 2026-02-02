const Bull = require('bull');
const { gameDb } = require('../config/database');
const { QUEUE_INTERVALS, BULL_JOB_OPTIONS, SERVER_TIME_TICK_SECONDS } = require('../config/constants');
const logger = require('../config/logger');

let io = null;

function setSocketIO(socketIO) {
  io = socketIO;
}

/**
 * Server Time Queue - Updates ingame time every 10 seconds
 * 1 real hour = 24 ingame hours (150 seconds per ingame hour)
 */
const timeQueue = new Bull('server-time', {
  redis: {
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT || '6379')
  },
  defaultJobOptions: BULL_JOB_OPTIONS
});

timeQueue.process('update-server-time', async (job) => {
  try {
    // Get current server time
    const [rows] = await gameDb.query(
      'SELECT id, started_at, last_updated FROM server_time WHERE id = 1'
    );

    let startedAt;
    const now = Math.floor(Date.now() / 1000);

    if (rows.length === 0) {
      // Initialize server time
      await gameDb.query(
        `INSERT INTO server_time (id, started_at, last_updated, ingame_hour, ingame_minute, tick_seconds)
         VALUES (1, ?, ?, 12, 0, ?)`,
        [now, now, SERVER_TIME_TICK_SECONDS]
      );
      startedAt = now;
    } else {
      startedAt = rows[0].started_at;
    }

    // Calculate elapsed real time in seconds
    const elapsed = now - startedAt;
    
    // Calculate ingame time
    // 150 seconds = 1 ingame hour
    // 1 real hour (3600s) = 24 ingame hours
    const totalIngameMinutes = Math.floor((elapsed / SERVER_TIME_TICK_SECONDS) * 60);
    const ingameHour = Math.floor(totalIngameMinutes / 60) % 24;
    const ingameMinute = totalIngameMinutes % 60;

    // Calculate daytime icon based on hour
    let daytimeIcon = '/assets/v1/time-icon-night.png';
    if (ingameHour === 5) daytimeIcon = '/assets/v1/time-icon-dawn.png';
    else if (ingameHour >= 6 && ingameHour <= 8) daytimeIcon = '/assets/v1/time-icon-morning.png';
    else if (ingameHour >= 9 && ingameHour <= 11) daytimeIcon = '/assets/v1/time-icon-day.png';
    else if (ingameHour >= 12 && ingameHour <= 16) daytimeIcon = '/assets/v1/time-icon-afternoon.png';
    else if (ingameHour === 17) daytimeIcon = '/assets/v1/time-icon-sunset.png';
    else if (ingameHour === 18) daytimeIcon = '/assets/v1/time-icon-dusk.png';
    else if (ingameHour >= 19 && ingameHour <= 20) daytimeIcon = '/assets/v1/time-icon-nightfall.png';

    // Update database
    await gameDb.query(
      `UPDATE server_time 
       SET last_updated = ?, ingame_hour = ?, ingame_minute = ?
       WHERE id = 1`,
      [now, ingameHour, ingameMinute]
    );

    // Emit time update event
    if (io) {
      io.emit('time:update', {
        ingameHour,
        ingameMinute,
        icon: daytimeIcon,
        realTime: now,
        startedAt
      });
    }

    return { ingameHour, ingameMinute };

  } catch (error) {
    logger.error('Time queue error', { error: error.message });
    throw error;
  }
});

timeQueue.on('completed', (job, result) => {
  logger.debug('Server time updated', result);
});

timeQueue.on('failed', (job, err) => {
  logger.error('Time queue failed', { error: err.message });
});

async function initTimeQueue() {
  await timeQueue.add(
    'update-server-time',
    {},
    {
      repeat: {
        every: QUEUE_INTERVALS.TIME
      },
      ...BULL_JOB_OPTIONS
    }
  );
  logger.info('Time queue initialized', { interval: `${QUEUE_INTERVALS.TIME}ms` });
}

module.exports = {
  timeQueue,
  initTimeQueue,
  setSocketIO
};
