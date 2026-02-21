/**
 * Cache: Walkers & Walk Speed
 *
 * Active walker state stored in Redis hash for tick processing.
 * Walk speed aggregation cached per-user from equipment + spell buffs.
 */
import type { Pool } from 'mysql2/promise';
import type { WalkerCacheEntry } from '../../types';

const { redis } = require('../database');
const logger = require('../logger');
const { CACHE_KEYS, TTL } = require('./keys');

// ── Walker State ──

/**
 * Store an active walker in Redis (called when createWalker inserts a DB row).
 * Also sets a user→walkerId mapping for quick user-based lookup.
 */
async function setActiveWalker(walkerId: number, walkerData: WalkerCacheEntry): Promise<void> {
  try {
    const pipeline = redis.pipeline();
    pipeline.hset(CACHE_KEYS.ACTIVE_WALKERS, String(walkerId), JSON.stringify(walkerData));
    pipeline.set(CACHE_KEYS.USER_WALKER + walkerData.user_id, String(walkerId));
    await pipeline.exec();
  } catch (e: any) {
    logger.error('Redis set failed (active walker)', { error: e.message, walkerId });
  }
}

/**
 * Get all active walkers from Redis hash.
 * Returns array of walker objects or null on failure.
 */
async function getActiveWalkers(): Promise<WalkerCacheEntry[] | null> {
  try {
    const all = await redis.hgetall(CACHE_KEYS.ACTIVE_WALKERS);
    if (!all || Object.keys(all).length === 0) return null;
    return Object.entries(all).map(([id, json]) => {
      const w = JSON.parse(json as string);
      w.walker_id = parseInt(id, 10);
      return w;
    });
  } catch (e: any) {
    logger.error('Redis get failed (active walkers)', { error: e.message });
    return null;
  }
}

/**
 * Update a walker's current_index in Redis (called every tick instead of DB).
 */
async function updateWalkerIndex(walkerId: number, currentIndex: number): Promise<void> {
  try {
    const raw = await redis.hget(CACHE_KEYS.ACTIVE_WALKERS, String(walkerId));
    if (raw) {
      const walker = JSON.parse(raw);
      walker.current_index = currentIndex;
      await redis.hset(CACHE_KEYS.ACTIVE_WALKERS, String(walkerId), JSON.stringify(walker));
    }
  } catch (e: any) {
    logger.error('Redis update failed (walker index)', { error: e.message, walkerId });
  }
}

/**
 * Remove a walker from Redis (called when walker completes, is interrupted, etc.).
 */
async function removeActiveWalker(walkerId: number, userId?: number): Promise<void> {
  try {
    const pipeline = redis.pipeline();
    pipeline.hdel(CACHE_KEYS.ACTIVE_WALKERS, String(walkerId));
    if (userId) pipeline.del(CACHE_KEYS.USER_WALKER + userId);
    await pipeline.exec();
  } catch (e: any) {
    logger.error('Redis del failed (active walker)', { error: e.message, walkerId });
  }
}

/**
 * Get the active walker for a specific user (by user_id).
 * Returns walker object or null.
 */
async function getActiveWalkerByUser(userId: number): Promise<WalkerCacheEntry | null> {
  try {
    const walkerId = await redis.get(CACHE_KEYS.USER_WALKER + userId);
    if (!walkerId) return null;
    const raw = await redis.hget(CACHE_KEYS.ACTIVE_WALKERS, walkerId);
    if (!raw) return null;
    const walker = JSON.parse(raw);
    walker.walker_id = parseInt(walkerId, 10);
    return walker;
  } catch (e: any) {
    logger.error('Redis get failed (user walker)', { error: e.message, userId });
    return null;
  }
}

/**
 * Remove any active walker for a user (called when a new walk interrupts an old one).
 */
async function removeActiveWalkerByUser(userId: number): Promise<void> {
  try {
    const walkerId = await redis.get(CACHE_KEYS.USER_WALKER + userId);
    if (walkerId) {
      await removeActiveWalker(walkerId, userId);
    }
  } catch (e: any) {
    logger.error('Redis del failed (user walker)', { error: e.message, userId });
  }
}

// ── Equipment Walk Speed ──

/**
 * Get cached walk_speed for a user. Returns number or null on cache miss.
 */
async function getCachedWalkSpeed(userId: number): Promise<number | null> {
  try {
    const val = await redis.get(CACHE_KEYS.WALK_SPEED + userId);
    if (val !== null) return parseFloat(val);
  } catch (e) { /* fall through */ }
  return null;
}

/**
 * Compute and cache the total walk_speed from a user's equipped items + active spell buffs.
 * Queries equipment + items tables and active_spells, caches the result.
 */
async function computeAndCacheWalkSpeed(gameDb: Pool, userId: number): Promise<number> {
  try {
    let totalWalkSpeed = 0;

    const [equipRows] = await gameDb.query(
      `SELECT COALESCE(e.head,0) as eq_head,
              COALESCE(e.body,0) as eq_body,
              COALESCE(e.hands,0) as eq_hands,
              COALESCE(e.shoulders,0) as eq_shoulders,
              COALESCE(e.legs,0) as eq_legs,
              COALESCE(e.weapon_right,0) as eq_weapon_right,
              COALESCE(e.weapon_left,0) as eq_weapon_left,
              COALESCE(e.ring_right,0) as eq_ring_right,
              COALESCE(e.ring_left,0) as eq_ring_left,
              COALESCE(e.amulet,0) as eq_amulet
       FROM equipment e WHERE e.user_id = ?`,
      [userId]
    ) as [any[], unknown];

    if (equipRows.length > 0) {
      const eq = equipRows[0];
      const equipmentIds = [
        eq.eq_head, eq.eq_body, eq.eq_hands, eq.eq_shoulders,
        eq.eq_legs, eq.eq_weapon_right, eq.eq_weapon_left,
        eq.eq_ring_right, eq.eq_ring_left, eq.eq_amulet
      ].filter(id => id && id > 0);

      if (equipmentIds.length > 0) {
        const [itemRows] = await gameDb.query(
          `SELECT i.stats FROM inventory inv
           JOIN items i ON inv.item_id = i.item_id
           WHERE inv.inventory_id IN (?)`,
          [equipmentIds]
        ) as [any[], unknown];

        itemRows.forEach((row: any) => {
          if (row.stats) {
            const stats = typeof row.stats === 'string' ? JSON.parse(row.stats) : row.stats;
            totalWalkSpeed += stats.walk_speed || 0;
          }
        });
      }
    }

    // Add walk_speed bonuses from active spells
    const [spellRows] = await gameDb.query(
      'SELECT walk_speed FROM active_spells WHERE user_id = ? AND walk_speed > 0 AND remaining > 0',
      [userId]
    ) as [any[], unknown];
    for (const row of spellRows) {
      totalWalkSpeed += row.walk_speed;
    }

    await redis.set(CACHE_KEYS.WALK_SPEED + userId, String(totalWalkSpeed), 'EX', TTL.USER_EQUIPMENT);
    return totalWalkSpeed;
  } catch (e: any) {
    logger.error('Failed to compute walk_speed', { error: e.message, userId });
    return 0;
  }
}

/**
 * Invalidate cached walk_speed for a user (call on equip/unequip).
 */
async function invalidateWalkSpeed(userId: number): Promise<void> {
  try {
    await redis.del(CACHE_KEYS.WALK_SPEED + userId);
  } catch (e) { /* ignore */ }
}

module.exports = {
  setActiveWalker,
  getActiveWalkers,
  updateWalkerIndex,
  removeActiveWalker,
  getActiveWalkerByUser,
  removeActiveWalkerByUser,
  getCachedWalkSpeed,
  computeAndCacheWalkSpeed,
  invalidateWalkSpeed,
};
