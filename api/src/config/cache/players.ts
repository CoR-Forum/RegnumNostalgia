/**
 * Cache: Online Players & last_active Buffering
 *
 * Redis sorted set for tracking who's online.
 * Buffered last_active timestamps flushed periodically to MariaDB.
 */
import type { Pool } from 'mysql2/promise';
import type { OnlinePlayerInfo } from '../../types';

const { redis } = require('../database');
const logger = require('../logger');
const { CACHE_KEYS, TTL } = require('./keys');

// ── Online Status ──

/**
 * Mark a player as online with their current info.
 * Uses a sorted set (score=timestamp) for efficient "who's online" queries.
 */
async function markPlayerOnline(userId: number, playerInfo: OnlinePlayerInfo): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  try {
    const pipeline = redis.pipeline();
    pipeline.zadd(CACHE_KEYS.ONLINE_PLAYERS, now, String(userId));
    pipeline.set(CACHE_KEYS.PLAYER_INFO + userId, JSON.stringify(playerInfo), 'EX', TTL.PLAYER_INFO);
    await pipeline.exec();
  } catch (e: any) { logger.error('Redis markPlayerOnline failed', { error: e.message }); }
}

/**
 * Remove a player from the online set.
 */
async function markPlayerOffline(userId: number): Promise<void> {
  try {
    const pipeline = redis.pipeline();
    pipeline.zrem(CACHE_KEYS.ONLINE_PLAYERS, String(userId));
    pipeline.del(CACHE_KEYS.PLAYER_INFO + userId);
    await pipeline.exec();
  } catch (e) { /* ignore */ }
}

/**
 * Update a player's position in cache.
 */
async function updatePlayerPosition(userId: number, x: number, y: number): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  try {
    // Update timestamp in sorted set
    await redis.zadd(CACHE_KEYS.ONLINE_PLAYERS, now, String(userId));

    // Update position in player info
    const infoKey = CACHE_KEYS.PLAYER_INFO + userId;
    const cached = await redis.get(infoKey);
    if (cached) {
      const info = JSON.parse(cached);
      info.x = x;
      info.y = y;
      await redis.set(infoKey, JSON.stringify(info), 'EX', TTL.PLAYER_INFO);
    }
  } catch (e) { /* ignore */ }
}

/**
 * Get all online players (active within threshold seconds).
 * Falls back to DB if Redis data is empty.
 */
async function getOnlinePlayers(gameDb: Pool, thresholdSeconds: number): Promise<OnlinePlayerInfo[]> {
  const cutoff = Math.floor(Date.now() / 1000) - thresholdSeconds;
  try {
    // Get user IDs active within threshold
    const userIds = await redis.zrangebyscore(CACHE_KEYS.ONLINE_PLAYERS, cutoff, '+inf');

    if (userIds.length > 0) {
      // Fetch player info from cache
      const pipeline = redis.pipeline();
      userIds.forEach((uid: string) => pipeline.get(CACHE_KEYS.PLAYER_INFO + uid));
      const results = await pipeline.exec();

      const players: OnlinePlayerInfo[] = [];
      const missingIds: string[] = [];

      results.forEach(([err, data]: [Error | null, string | null], idx: number) => {
        if (!err && data) {
          try { players.push(JSON.parse(data)); } catch (e) { missingIds.push(userIds[idx]); }
        } else {
          missingIds.push(userIds[idx]);
        }
      });

      // If some players are missing from cache, fetch from DB
      if (missingIds.length > 0) {
        const [dbPlayers] = await gameDb.query(
          `SELECT user_id, username, realm, x, y, level, health, max_health
           FROM players WHERE user_id IN (?)`,
          [missingIds.map(Number)]
        ) as [any[], unknown];

        for (const p of dbPlayers) {
          const info = {
            userId: p.user_id,
            username: p.username,
            realm: p.realm,
            x: p.x,
            y: p.y,
            level: p.level,
            health: p.health,
            maxHealth: p.max_health
          };
          players.push(info);
          // Cache for next time
          markPlayerOnline(p.user_id, info);
        }
      }

      return players;
    }
  } catch (e: any) {
    logger.error('Redis getOnlinePlayers failed, falling back to DB', { error: e.message });
  }

  // Fallback: query DB directly
  const [players] = await gameDb.query(
    `SELECT user_id, username, realm, x, y, level, health, max_health
     FROM players 
     WHERE last_active > DATE_SUB(NOW(), INTERVAL ? SECOND)
     AND realm IS NOT NULL`,
    [thresholdSeconds]
  ) as [any[], unknown];

  return players.map((p: any) => ({
    userId: p.user_id,
    username: p.username,
    realm: p.realm,
    x: p.x,
    y: p.y,
    level: p.level,
    health: p.health,
    maxHealth: p.max_health
  }));
}

/**
 * Clean up expired entries from the online sorted set.
 */
async function cleanupOnlinePlayers(thresholdSeconds: number): Promise<void> {
  const cutoff = Math.floor(Date.now() / 1000) - thresholdSeconds;
  try {
    await redis.zremrangebyscore(CACHE_KEYS.ONLINE_PLAYERS, '-inf', cutoff);
  } catch (e) { /* ignore */ }
}

// ── last_active Buffering ──

/**
 * Buffer a last_active update in Redis instead of hitting DB immediately.
 */
async function bufferLastActive(userId: number): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  try {
    await redis.zadd(CACHE_KEYS.LAST_ACTIVE, now, String(userId));
  } catch (e) { /* ignore - non-critical */ }
}

/**
 * Flush buffered last_active timestamps to MariaDB.
 * Called periodically (e.g., every 5 seconds).
 */
async function flushLastActive(gameDb: Pool): Promise<number> {
  try {
    const entries = await redis.zrangebyscore(CACHE_KEYS.LAST_ACTIVE, '-inf', '+inf', 'WITHSCORES');
    if (entries.length === 0) return 0;

    // entries = [userId1, score1, userId2, score2, ...]
    const updates = [];
    for (let i = 0; i < entries.length; i += 2) {
      const userId = parseInt(entries[i], 10);
      const timestamp = parseInt(entries[i + 1], 10);
      if (!Number.isFinite(userId) || !Number.isFinite(timestamp)) continue;
      updates.push({ userId, timestamp });
    }

    if (updates.length === 0) return 0;

    // Batch update using CASE statement — values are validated integers above
    const userIds = updates.map(u => u.userId);
    const cases = updates.map(u => `WHEN ${u.userId} THEN ${u.timestamp}`).join(' ');
    
    await gameDb.query(
      `UPDATE players SET last_active = CASE user_id ${cases} END WHERE user_id IN (?)`,
      [userIds]
    );

    // Clear the buffer
    await redis.del(CACHE_KEYS.LAST_ACTIVE);

    return updates.length;
  } catch (e) {
    logger.error('Failed to flush last_active buffer', { error: (e as any).message });
    return 0;
  }
}

// ── GM Status ──

async function getCachedGMStatus(forumDb: Pool, userId: number): Promise<boolean> {
  const cacheKey = CACHE_KEYS.USER_GM + userId;
  try {
    const cached = await redis.get(cacheKey);
    if (cached !== null) return cached === '1';
  } catch (e) { /* fall through */ }

  const [rows] = await forumDb.query(
    'SELECT groupID FROM wcf1_user_to_group WHERE userID = ? AND groupID = 32',
    [userId]
  ) as [any[], unknown];
  const isGm = rows.length > 0;

  try {
    await redis.set(cacheKey, isGm ? '1' : '0', 'EX', TTL.USER_GM);
  } catch (e) { /* ignore */ }

  return isGm;
}

module.exports = {
  markPlayerOnline,
  markPlayerOffline,
  updatePlayerPosition,
  getOnlinePlayers,
  cleanupOnlinePlayers,
  bufferLastActive,
  flushLastActive,
  getCachedGMStatus,
};
