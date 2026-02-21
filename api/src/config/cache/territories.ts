/**
 * Cache: Territories & Superbosses
 *
 * Semi-static world data with short TTL and manual invalidation.
 */
import type { Pool } from 'mysql2/promise';
import type { TerritoryRow, SuperbossRow } from '../../types';

const { redis } = require('../database');
const logger = require('../logger');
const { CACHE_KEYS, TTL } = require('./keys');

// ── Territories ──

async function getCachedTerritories(gameDb: Pool): Promise<TerritoryRow[]> {
  try {
    const cached = await redis.get(CACHE_KEYS.TERRITORIES);
    if (cached) return JSON.parse(cached);
  } catch (e) { /* fall through */ }

  const [territories] = await gameDb.query(
    `SELECT territory_id, realm, name, type, health, max_health, x, y,
            owner_realm, contested, icon_name, icon_name_contested
     FROM territories ORDER BY territory_id`
  ) as [TerritoryRow[], unknown];

  try {
    await redis.set(CACHE_KEYS.TERRITORIES, JSON.stringify(territories), 'EX', TTL.TERRITORIES);
  } catch (e: any) { logger.error('Redis set failed (territories)', { error: e.message }); }

  return territories;
}

async function invalidateTerritories(): Promise<void> {
  try { await redis.del(CACHE_KEYS.TERRITORIES); } catch (e) { /* ignore */ }
}

// ── Superbosses ──

async function getCachedSuperbosses(gameDb: Pool): Promise<SuperbossRow[]> {
  try {
    const cached = await redis.get(CACHE_KEYS.SUPERBOSSES);
    if (cached) return JSON.parse(cached);
  } catch (e) { /* fall through */ }

  const [superbosses] = await gameDb.query(
    `SELECT boss_id, name, icon_name, health, max_health, x, y
     FROM superbosses ORDER BY boss_id`
  ) as [SuperbossRow[], unknown];

  try {
    await redis.set(CACHE_KEYS.SUPERBOSSES, JSON.stringify(superbosses), 'EX', TTL.SUPERBOSSES);
  } catch (e: any) { logger.error('Redis set failed (superbosses)', { error: e.message }); }

  return superbosses;
}

async function invalidateSuperbosses(): Promise<void> {
  try { await redis.del(CACHE_KEYS.SUPERBOSSES); } catch (e) { /* ignore */ }
}

module.exports = {
  getCachedTerritories,
  invalidateTerritories,
  getCachedSuperbosses,
  invalidateSuperbosses,
};
