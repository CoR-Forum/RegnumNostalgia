const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const { optionalAuth } = require('../middleware/auth');
const logger = require('../config/logger');

let regionsCache = null;

/**
 * Load regions from JSON file
 */
async function loadRegions() {
  if (regionsCache) return regionsCache;
  
  try {
    const regionsFile = path.join(__dirname, '../../gameData/regions.json');
    const data = await fs.readFile(regionsFile, 'utf8');
    regionsCache = JSON.parse(data);
    logger.info('Loaded regions data');
    return regionsCache;
  } catch (error) {
    logger.error('Failed to load regions.json', { error: error.message });
    throw error;
  }
}

/**
 * GET /regions
 * Returns all polygonal regions with ownership and walkability rules
 */
router.get('/', optionalAuth, async (req, res) => {
  try {
    const regions = await loadRegions();
    res.json({ regions });
  } catch (error) {
    logger.error('Failed to get regions', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
module.exports.loadRegions = loadRegions;
