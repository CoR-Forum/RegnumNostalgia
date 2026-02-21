const logger = require('../config/logger');

/**
 * Parse a settings body (camelCase keys) into DB-ready column values.
 * Accepts partial updates — only keys present in `body` are used;
 * missing keys fall back to `defaults`.
 */
function parseSettings(body, defaults = {}) {
  const d = Object.assign({
    musicEnabled: 0,
    musicVolume: 0.6,
    soundsEnabled: 1,
    soundVolume: 1.0,
    captureSoundsEnabled: 1,
    captureSoundsVolume: 1.0,
    collectionSoundsEnabled: 1,
    collectionSoundsVolume: 1.0,
    mapVersion: 'v1-compressed',
    quickbarTooltipsEnabled: 1
  }, defaults);

  const src = body || {};

  return {
    music_enabled:               (typeof src.musicEnabled !== 'undefined' ? src.musicEnabled : d.musicEnabled) ? 1 : 0,
    music_volume:                typeof src.musicVolume === 'number' ? src.musicVolume : parseFloat(src.musicVolume ?? d.musicVolume) || 0.6,
    sounds_enabled:              (typeof src.soundsEnabled !== 'undefined' ? src.soundsEnabled : d.soundsEnabled) ? 1 : 0,
    sound_volume:                typeof src.soundVolume === 'number' ? src.soundVolume : parseFloat(src.soundVolume ?? d.soundVolume) || 1.0,
    capture_sounds_enabled:      (typeof src.captureSoundsEnabled !== 'undefined' ? src.captureSoundsEnabled : d.captureSoundsEnabled) ? 1 : 0,
    capture_sounds_volume:       typeof src.captureSoundsVolume === 'number' ? src.captureSoundsVolume : parseFloat(src.captureSoundsVolume ?? d.captureSoundsVolume) || 1.0,
    collection_sounds_enabled:   (typeof src.collectionSoundsEnabled !== 'undefined' ? src.collectionSoundsEnabled : d.collectionSoundsEnabled) ? 1 : 0,
    collection_sounds_volume:    typeof src.collectionSoundsVolume === 'number' ? src.collectionSoundsVolume : parseFloat(src.collectionSoundsVolume ?? d.collectionSoundsVolume) || 1.0,
    map_version:                 typeof src.mapVersion === 'string' ? src.mapVersion : (src.mapVersion || d.mapVersion || 'v1-compressed'),
    quickbar_tooltips_enabled:   (typeof src.quickbarTooltipsEnabled !== 'undefined' ? src.quickbarTooltipsEnabled : d.quickbarTooltipsEnabled) ? 1 : 0,
  };
}

/**
 * Upsert user settings into the database.
 * @param {object} db    The gameDb connection pool
 * @param {number} userId
 * @param {object} body  camelCase settings object (partial or full)
 */
async function upsertUserSettings(db, userId, body) {
  const s = parseSettings(body);
  const updatedAt = Math.floor(Date.now() / 1000);

  await db.query(
    `INSERT INTO user_settings (user_id, music_enabled, music_volume, sounds_enabled, sound_volume, capture_sounds_enabled, capture_sounds_volume, collection_sounds_enabled, collection_sounds_volume, map_version, quickbar_tooltips_enabled, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       music_enabled = VALUES(music_enabled),
       music_volume = VALUES(music_volume),
       sounds_enabled = VALUES(sounds_enabled),
       sound_volume = VALUES(sound_volume),
       capture_sounds_enabled = VALUES(capture_sounds_enabled),
       capture_sounds_volume = VALUES(capture_sounds_volume),
       collection_sounds_enabled = VALUES(collection_sounds_enabled),
       collection_sounds_volume = VALUES(collection_sounds_volume),
       map_version = VALUES(map_version),
       quickbar_tooltips_enabled = VALUES(quickbar_tooltips_enabled),
       updated_at = VALUES(updated_at)`,
    [userId, s.music_enabled, s.music_volume, s.sounds_enabled, s.sound_volume,
     s.capture_sounds_enabled, s.capture_sounds_volume,
     s.collection_sounds_enabled, s.collection_sounds_volume,
     s.map_version, s.quickbar_tooltips_enabled, updatedAt]
  );
}

module.exports = { upsertUserSettings, parseSettings };
