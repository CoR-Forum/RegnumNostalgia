const express = require('express');
const router = express.Router();
const { authenticateJWT } = require('../middleware/auth');
const { gameDb } = require('../config/database');
const logger = require('../config/logger');

// Get current user's settings
router.get('/', authenticateJWT, async (req, res) => {
  try {
    const userId = req.user.userId;
    const [rows] = await gameDb.query('SELECT music_enabled, music_volume, sounds_enabled, sound_volume, capture_sounds_enabled, capture_sounds_volume, map_version FROM user_settings WHERE user_id = ?', [userId]);
    if (rows && rows.length > 0) {
      return res.json({ success: true, settings: rows[0] });
    }
    // return defaults
    return res.json({ success: true, settings: {
      music_enabled: 1,
      music_volume: 0.6,
      sounds_enabled: 1,
      sound_volume: 1.0,
      capture_sounds_enabled: 1,
      capture_sounds_volume: 1.0,
      map_version: 'v1'
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

    const music_enabled = body.music_enabled ? 1 : 0;
    const music_volume = typeof body.music_volume === 'number' ? body.music_volume : parseFloat(body.music_volume) || 0.6;
    const sounds_enabled = body.sounds_enabled ? 1 : 0;
    const sound_volume = typeof body.sound_volume === 'number' ? body.sound_volume : parseFloat(body.sound_volume) || 1.0;
    const capture_sounds_enabled = body.capture_sounds_enabled ? 1 : 0;
    const capture_sounds_volume = typeof body.capture_sounds_volume === 'number' ? body.capture_sounds_volume : parseFloat(body.capture_sounds_volume) || 1.0;
    const map_version = typeof body.map_version === 'string' ? body.map_version : (body.map_version || 'v1');
    const updatedAt = Math.floor(Date.now() / 1000);

    await gameDb.query(
      `INSERT INTO user_settings (user_id, music_enabled, music_volume, sounds_enabled, sound_volume, capture_sounds_enabled, capture_sounds_volume, map_version, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         music_enabled = VALUES(music_enabled),
         music_volume = VALUES(music_volume),
         sounds_enabled = VALUES(sounds_enabled),
         sound_volume = VALUES(sound_volume),
         capture_sounds_enabled = VALUES(capture_sounds_enabled),
         capture_sounds_volume = VALUES(capture_sounds_volume),
         map_version = VALUES(map_version),
         updated_at = VALUES(updated_at)`,
      [userId, music_enabled, music_volume, sounds_enabled, sound_volume, capture_sounds_enabled, capture_sounds_volume, map_version, updatedAt]
    );

    return res.json({ success: true });
  } catch (err) {
    logger.error('Failed to update user settings', { error: err.message });
    res.status(500).json({ success: false, error: 'Failed to update settings' });
  }
});

module.exports = router;
