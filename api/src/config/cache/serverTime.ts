/**
 * Cache: Server Time
 *
 * Semi-static game clock data with short TTL.
 */
import type { Pool } from 'mysql2/promise';
import type { ServerTimeRow } from '../../types';

const { redis } = require('../database');
const logger = require('../logger');
const { CACHE_KEYS, TTL } = require('./keys');

async function getCachedServerTime(gameDb: Pool): Promise<ServerTimeRow | null> {
  try {
    const cached = await redis.get(CACHE_KEYS.SERVER_TIME);
    if (cached) return JSON.parse(cached);
  } catch (e) { /* fall through */ }

  const [rows] = await gameDb.query('SELECT * FROM server_time WHERE id = 1');
  if (rows.length === 0) return null;

  const serverTime = rows[0];
  try {
    await redis.set(CACHE_KEYS.SERVER_TIME, JSON.stringify(serverTime), 'EX', TTL.SERVER_TIME);
  } catch (e) { logger.error('Redis set failed (server_time)', { error: e.message }); }

  return serverTime;
}

async function setCachedServerTime(data: ServerTimeRow): Promise<void> {
  try {
    await redis.set(CACHE_KEYS.SERVER_TIME, JSON.stringify(data), 'EX', TTL.SERVER_TIME);
  } catch (e) { /* ignore */ }
}

async function invalidateServerTime(): Promise<void> {
  try { await redis.del(CACHE_KEYS.SERVER_TIME); } catch (e) { /* ignore */ }
}

module.exports = {
  getCachedServerTime,
  setCachedServerTime,
  invalidateServerTime,
};
