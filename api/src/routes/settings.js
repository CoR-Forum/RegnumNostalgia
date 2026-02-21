const express = require('express');
const router = express.Router();
const { authenticateJWT } = require('../middleware/auth');
const { gameDb } = require('../config/database');
const logger = require('../config/logger');
const { getCachedUserSettings, invalidateUserSettings } = require('../config/cache');
const { upsertUserSettings } = require('../services/settingsService');

// Get current user's settings
router.get('/', authenticateJWT, async (req, res) => {
  try {
    const userId = req.user.userId;
    const row = await getCachedUserSettings(gameDb, userId);
    if (row) {
      return res.json({ success: true, settings: {
        musicEnabled: row.musicEnabled ? 1 : 0,
        musicVolume: typeof row.musicVolume === 'number' ? row.musicVolume : 0.6,
        soundsEnabled: row.soundsEnabled ? 1 : 0,
        soundVolume: typeof row.soundVolume === 'number' ? row.soundVolume : 1.0,
        captureSoundsEnabled: row.captureSoundsEnabled ? 1 : 0,
        captureSoundsVolume: typeof row.captureSoundsVolume === 'number' ? row.captureSoundsVolume : 1.0,
        collectionSoundsEnabled: row.collectionSoundsEnabled ? 1 : 0,
        collectionSoundsVolume: typeof row.collectionSoundsVolume === 'number' ? row.collectionSoundsVolume : 1.0,
        mapVersion: row.mapVersion || 'v1-compressed',
        quickbarTooltipsEnabled: row.quickbarTooltipsEnabled ? 1 : 0
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
    await upsertUserSettings(gameDb, userId, req.body || {});

    // Invalidate cached settings so next read picks up changes
    await invalidateUserSettings(userId);

    return res.json({ success: true });
  } catch (err) {
    logger.error('Failed to update user settings', { error: err.message });
    res.status(500).json({ success: false, error: 'Failed to update settings' });
  }
});

module.exports = router;
