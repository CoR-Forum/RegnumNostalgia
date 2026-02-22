const mysql = require('mysql2/promise');
const sqlite3 = require('sqlite3').verbose();
const Redis = require('ioredis');
const logger = require('./logger');

// Game Database (MariaDB) Connection Pool
const gameDbPool = mysql.createPool({
  host: process.env.GAME_DB_HOST || 'db',
  port: parseInt(process.env.GAME_DB_PORT || '3306'),
  database: process.env.GAME_DB_NAME || 'regnum_nostalgia',
  user: process.env.GAME_DB_USER || (() => { throw new Error('GAME_DB_USER environment variable is required'); })(),
  password: process.env.GAME_DB_PASS || (() => { throw new Error('GAME_DB_PASS environment variable is required'); })(),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

// Forum Database (External MySQL) Connection Pool
const forumDbPool = mysql.createPool({
  host: process.env.COR_FORUM_DB_HOST || 'localhost',
  port: parseInt(process.env.COR_FORUM_DB_PORT || '3306'),
  database: process.env.COR_FORUM_DB_NAME || 'corforum_database',
  user: process.env.COR_FORUM_DB_USER || (() => { throw new Error('COR_FORUM_DB_USER environment variable is required'); })(),
  password: process.env.COR_FORUM_DB_PASS || (() => { throw new Error('COR_FORUM_DB_PASS environment variable is required'); })(),
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0
});

// SQLite Database for Screenshots
let screenshotsDb = null;

function initScreenshotsDb() {
  return new Promise((resolve, reject) => {
    const dbPath = process.env.SCREENSHOTS_DB_PATH || './screenshots.sqlite';
    screenshotsDb = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        logger.error('Failed to connect to screenshots database', { error: err.message });
        reject(err);
      } else {
        logger.info('Connected to screenshots SQLite database');
        resolve(screenshotsDb);
      }
    });
  });
}

// Redis Client
const redisClient = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
});

redisClient.on('connect', () => {
  logger.info('Connected to Redis');
});

redisClient.on('error', (err) => {
  logger.error('Redis connection error', { error: err.message });
});

// Test database connections
async function testConnections() {
  try {
    // Test game DB
    await gameDbPool.query('SELECT 1');
    logger.info('Game database connection successful');
  } catch (error) {
    logger.error('Game database connection failed', { error: error.message || String(error) });
    throw error;
  }

  try {
    // Test forum DB
    await forumDbPool.query('SELECT 1');
    logger.info('Forum database connection successful');
  } catch (error) {
    logger.warn('Forum database connection failed — shoutbox will be unavailable', { error: error.message || String(error) });
  }

  try {
    // Test Redis
    await redisClient.ping();
    logger.info('Redis connection successful');
  } catch (error) {
    logger.error('Redis connection failed', { error: error.message || String(error) });
    throw error;
  }

  return true;
}

module.exports = {
  gameDb: gameDbPool,
  forumDb: forumDbPool,
  screenshotsDb: () => screenshotsDb,
  initScreenshotsDb,
  redis: redisClient,
  testConnections
};
