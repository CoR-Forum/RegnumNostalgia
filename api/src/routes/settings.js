const express = require('express');
const router = express.Router();
const { authenticateJWT } = require('../middleware/auth');
const { gameDb } = require('../config/database');
const logger = require('../config/logger');

// Get current user's settings
router.get('/', authenticateJWT, async (req, res) => {
  try {
    const userId = req.user.userId;
    const [rows] = await gameDb.query('SELECT music_enabled, music_volume, sounds_enabled, sound_volume, capture_sounds_enabled, capture_sounds_volume, collection_sounds_enabled, collection_sounds_volume, map_version FROM user_settings WHERE user_id = ?', [userId]);
    if (rows && rows.length > 0) {
      const row = rows[0];
      return res.json({ success: true, settings: {
        musicEnabled: row.music_enabled === 1 ? 1 : 0,
        musicVolume: typeof row.music_volume === 'number' ? row.music_volume : parseFloat(row.music_volume) || 0.6,
        soundsEnabled: row.sounds_enabled === 1 ? 1 : 0,
        soundVolume: typeof row.sound_volume === 'number' ? row.sound_volume : parseFloat(row.sound_volume) || 1.0,
        captureSoundsEnabled: row.capture_sounds_enabled === 1 ? 1 : 0,
        captureSoundsVolume: typeof row.capture_sounds_volume === 'number' ? row.capture_sounds_volume : parseFloat(row.capture_sounds_volume) || 1.0,
        collectionSoundsEnabled: row.collection_sounds_enabled === 1 ? 1 : 0,
        collectionSoundsVolume: typeof row.collection_sounds_volume === 'number' ? row.collection_sounds_volume : parseFloat(row.collection_sounds_volume) || 1.0,
        mapVersion: row.map_version || 'v1'
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
      mapVersion: 'v1'
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
    const map_version = typeof body.mapVersion === 'string' ? body.mapVersion : (body.mapVersion || 'v1');
    const updatedAt = Math.floor(Date.now() / 1000);

    await gameDb.query(
      `INSERT INTO user_settings (user_id, music_enabled, music_volume, sounds_enabled, sound_volume, capture_sounds_enabled, capture_sounds_volume, collection_sounds_enabled, collection_sounds_volume, map_version, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
         updated_at = VALUES(updated_at)`,
      [userId, music_enabled, music_volume, sounds_enabled, sound_volume, capture_sounds_enabled, capture_sounds_volume, collection_sounds_enabled, collection_sounds_volume, map_version, updatedAt]
    );

    return res.json({ success: true });
  } catch (err) {
    logger.error('Failed to update user settings', { error: err.message });
    res.status(500).json({ success: false, error: 'Failed to update settings' });
  }
});

module.exports = router;
