/**
 * Cache: Items & Levels
 *
 * Static data cached permanently in Redis.
 * Includes preloadStaticData() for startup initialization.
 */
import type { Pool } from 'mysql2/promise';
import type { ItemRow } from '../../types';

const { redis } = require('../database');
const logger = require('../logger');
const { CACHE_KEYS } = require('./keys');

/**
 * Get item by template_key. Checks Redis first, falls back to DB.
 */
async function getItemByTemplateKey(gameDb: Pool, templateKey: string): Promise<ItemRow | null> {
  const cacheKey = CACHE_KEYS.ITEM_BY_TEMPLATE + templateKey;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (e) { /* fall through to DB */ }

  const [rows] = await gameDb.query('SELECT * FROM items WHERE template_key = ?', [templateKey]) as [ItemRow[], unknown];
  if (rows.length === 0) return null;

  const item = rows[0];
  try {
    await redis.set(cacheKey, JSON.stringify(item));
    // Also cache by ID
    await redis.set(CACHE_KEYS.ITEM_BY_ID + item.item_id, JSON.stringify(item));
  } catch (e: any) { logger.error('Redis set failed (item tmpl)', { error: e.message }); }

  return item;
}

/**
 * Get item by item_id. Checks Redis first, falls back to DB.
 */
async function getItemById(gameDb: Pool, itemId: number): Promise<ItemRow | null> {
  const cacheKey = CACHE_KEYS.ITEM_BY_ID + itemId;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (e) { /* fall through */ }

  const [rows] = await gameDb.query('SELECT * FROM items WHERE item_id = ?', [itemId]) as [ItemRow[], unknown];
  if (rows.length === 0) return null;

  const item = rows[0];
  try {
    await redis.set(cacheKey, JSON.stringify(item));
    await redis.set(CACHE_KEYS.ITEM_BY_TEMPLATE + item.template_key, JSON.stringify(item));
  } catch (e: any) { logger.error('Redis set failed (item id)', { error: e.message }); }

  return item;
}

/**
 * Get XP required for a specific level. Uses Redis hash for all levels.
 */
async function getLevelXp(gameDb: Pool, level: number): Promise<number | null> {
  try {
    const cached = await redis.hget(CACHE_KEYS.LEVEL_XP, String(level));
    if (cached !== null) return Number(cached);
  } catch (e) { /* fall through */ }

  // Load all levels at once into the hash
  const [rows] = await gameDb.query('SELECT level, xp FROM levels ORDER BY level') as [Array<{ level: number; xp: number }>, unknown];
  if (rows.length > 0) {
    const pipeline = redis.pipeline();
    for (const row of rows) {
      pipeline.hset(CACHE_KEYS.LEVEL_XP, String(row.level), String(row.xp));
    }
    try { await pipeline.exec(); } catch (e: any) { logger.error('Redis pipeline failed (levels)', { error: e.message }); }
  }

  const match = rows.find((r: { level: number; xp: number }) => r.level === level);
  return match ? Number(match.xp) : null;
}

/**
 * Preload all items and levels into Redis cache.
 * Call this during server startup.
 */
async function preloadStaticData(gameDb: Pool): Promise<void> {
  try {
    // Preload all items
    const [items] = await gameDb.query('SELECT * FROM items') as [ItemRow[], unknown];
    const pipeline = redis.pipeline();
    for (const item of items) {
      pipeline.set(CACHE_KEYS.ITEM_BY_TEMPLATE + item.template_key, JSON.stringify(item));
      pipeline.set(CACHE_KEYS.ITEM_BY_ID + item.item_id, JSON.stringify(item));
    }
    await pipeline.exec();
    logger.info(`Preloaded ${items.length} items into Redis cache`);

    // Preload all levels
    const [levels] = await gameDb.query('SELECT level, xp FROM levels ORDER BY level') as [Array<{ level: number; xp: number }>, unknown];
    const levelPipeline = redis.pipeline();
    for (const lvl of levels) {
      levelPipeline.hset(CACHE_KEYS.LEVEL_XP, String(lvl.level), String(lvl.xp));
    }
    await levelPipeline.exec();
    logger.info(`Preloaded ${levels.length} levels into Redis cache`);

  } catch (e: any) {
    logger.error('Failed to preload static data into Redis', { error: e.message });
  }
}

module.exports = {
  getItemByTemplateKey,
  getItemById,
  getLevelXp,
  preloadStaticData,
};
