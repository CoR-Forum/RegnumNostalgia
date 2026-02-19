const express = require('express');
const router = express.Router();
const { authenticateJWT } = require('../middleware/auth');
const { gameDb } = require('../config/database');
const logger = require('../config/logger');
const { getCachedUserSettings, invalidateUserSettings } = require('../config/cache');

// Get current user's settings
router.get('/', authenticateJWT, async (req, res) => {
  try {
    const userId = req.user.userId;
    const row = await getCachedUserSettings(gameDb, userId);
    if (row) {
      return res.json({ success: true, settings: {
        musicEnabled: row.musicEnabled != null ? (row.musicEnabled ? 1 : 0) : (row.music_enabled === 1 ? 1 : 0),
        musicVolume: typeof row.musicVolume === 'number' ? row.musicVolume : (typeof row.music_volume === 'number' ? row.music_volume : parseFloat(row.music_volume || row.musicVolume) || 0.6),
        soundsEnabled: row.soundsEnabled != null ? (row.soundsEnabled ? 1 : 0) : (row.sounds_enabled === 1 ? 1 : 0),
        soundVolume: typeof row.soundVolume === 'number' ? row.soundVolume : (typeof row.sound_volume === 'number' ? row.sound_volume : parseFloat(row.sound_volume || row.soundVolume) || 1.0),
        captureSoundsEnabled: row.captureSoundsEnabled != null ? (row.captureSoundsEnabled ? 1 : 0) : (row.capture_sounds_enabled === 1 ? 1 : 0),
        captureSoundsVolume: typeof row.captureSoundsVolume === 'number' ? row.captureSoundsVolume : (typeof row.capture_sounds_volume === 'number' ? row.capture_sounds_volume : parseFloat(row.capture_sounds_volume || row.captureSoundsVolume) || 1.0),
        collectionSoundsEnabled: row.collectionSoundsEnabled != null ? (row.collectionSoundsEnabled ? 1 : 0) : (row.collection_sounds_enabled === 1 ? 1 : 0),
        collectionSoundsVolume: typeof row.collectionSoundsVolume === 'number' ? row.collectionSoundsVolume : (typeof row.collection_sounds_volume === 'number' ? row.collection_sounds_volume : parseFloat(row.collection_sounds_volume || row.collectionSoundsVolume) || 1.0),
        mapVersion: row.mapVersion || row.map_version || 'v1-compressed',
        quickbarTooltipsEnabled: row.quickbarTooltipsEnabled != null ? (row.quickbarTooltipsEnabled ? 1 : 0) : (row.quickbar_tooltips_enabled === 1 ? 1 : 0)
      }});
    }
    // return defaults
    return res.json({ success: true, settings: {
      musicEnabled: 0,
      musicVolume: 0.20,
      soundsEnabled: 1,
      soundVolume: 1.0,
      captureSoundsEnabled: 1,
      captureSoundsVolume: 1.0,
      collectionSoundsEnabled: 1,
      collectionSoundsVolume: 1.0,
      mapVersion: 'v1-compressed',
      quickbarTooltipsEnabled: 1
    }});
  } catch (err) {
    logger.error('Failed to get user settings', { error: err.message });
    res.status(500).json({ success: false, error: 'Failed to load settings' });
  }
});

// Update user's settings
router.post('/', authenticateJWT, async (req, res) => {
  try {
    const userId = req.user.userId;
    const body = req.body || {};

    const music_enabled = body.musicEnabled ? 1 : 0;
    const music_volume = typeof body.musicVolume === 'number' ? body.musicVolume : parseFloat(body.musicVolume) || 0.6;
    const sounds_enabled = body.soundsEnabled ? 1 : 0;
    const sound_volume = typeof body.soundVolume === 'number' ? body.soundVolume : parseFloat(body.soundVolume) || 1.0;
    const capture_sounds_enabled = body.captureSoundsEnabled ? 1 : 0;
    const capture_sounds_volume = typeof body.captureSoundsVolume === 'number' ? body.captureSoundsVolume : parseFloat(body.captureSoundsVolume) || 1.0;
    const collection_sounds_enabled = body.collectionSoundsEnabled ? 1 : 0;
    const collection_sounds_volume = typeof body.collectionSoundsVolume === 'number' ? body.collectionSoundsVolume : parseFloat(body.collectionSoundsVolume) || 1.0;
    const map_version = typeof body.mapVersion === 'string' ? body.mapVersion : (body.mapVersion || 'v1-compressed');
    const quickbar_tooltips_enabled = body.quickbarTooltipsEnabled ? 1 : 0;
    const updatedAt = Math.floor(Date.now() / 1000);

    await gameDb.query(
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
      [userId, music_enabled, music_volume, sounds_enabled, sound_volume, capture_sounds_enabled, capture_sounds_volume, collection_sounds_enabled, collection_sounds_volume, map_version, quickbar_tooltips_enabled, updatedAt]
    );

    // Invalidate cached settings so next read picks up changes
    await invalidateUserSettings(userId);

    return res.json({ success: true });
  } catch (err) {
    logger.error('Failed to update user settings', { error: err.message });
    res.status(500).json({ success: false, error: 'Failed to update settings' });
  }
});

module.exports = router;
