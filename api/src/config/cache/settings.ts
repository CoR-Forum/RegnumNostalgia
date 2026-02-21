/**
 * Cache: User Settings
 *
 * Per-user settings cached with TTL, invalidated on write.
 */
import type { Pool } from 'mysql2/promise';
import type { UserSettingsPayload } from '../../types';

const { redis } = require('../database');
const { CACHE_KEYS, TTL } = require('./keys');

async function getCachedUserSettings(gameDb: Pool, userId: number): Promise<UserSettingsPayload | null> {
  const cacheKey = CACHE_KEYS.USER_SETTINGS + userId;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (e) { /* fall through */ }

  const [rows] = await gameDb.query(
    'SELECT music_enabled, music_volume, sounds_enabled, sound_volume, capture_sounds_enabled, capture_sounds_volume, collection_sounds_enabled, collection_sounds_volume, map_version, quickbar_tooltips_enabled FROM user_settings WHERE user_id = ?',
    [userId]
  ) as [any[], unknown];

  const settings: UserSettingsPayload | null = rows && rows.length > 0 ? {
    musicEnabled: rows[0].music_enabled === 1,
    musicVolume: typeof rows[0].music_volume === 'number' ? rows[0].music_volume : parseFloat(rows[0].music_volume) || 0.6,
    soundsEnabled: rows[0].sounds_enabled === 1,
    soundVolume: typeof rows[0].sound_volume === 'number' ? rows[0].sound_volume : parseFloat(rows[0].sound_volume) || 1.0,
    captureSoundsEnabled: rows[0].capture_sounds_enabled === 1,
    captureSoundsVolume: typeof rows[0].capture_sounds_volume === 'number' ? rows[0].capture_sounds_volume : parseFloat(rows[0].capture_sounds_volume) || 1.0,
    collectionSoundsEnabled: rows[0].collection_sounds_enabled === 1,
    collectionSoundsVolume: typeof rows[0].collection_sounds_volume === 'number' ? rows[0].collection_sounds_volume : parseFloat(rows[0].collection_sounds_volume) || 1.0,
    mapVersion: rows[0].map_version || 'v1-compressed',
    quickbarTooltipsEnabled: rows[0].quickbar_tooltips_enabled === 1
  } : null;

  if (settings) {
    try {
      await redis.set(cacheKey, JSON.stringify(settings), 'EX', TTL.USER_SETTINGS);
    } catch (e) { /* ignore */ }
  }

  return settings;
}

async function invalidateUserSettings(userId: number): Promise<void> {
  try { await redis.del(CACHE_KEYS.USER_SETTINGS + userId); } catch (e) { /* ignore */ }
}

module.exports = {
  getCachedUserSettings,
  invalidateUserSettings,
};
