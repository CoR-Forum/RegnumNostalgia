const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const { optionalAuth } = require('../middleware/auth');
const logger = require('../config/logger');

let pathsCache = null;
let regionsCache = null;

/**
 * Load paths from JSON file
 */
async function loadPaths() {
  if (pathsCache) return pathsCache;
  
  try {
    const pathsFile = path.join(__dirname, '../../gameData/paths.json');
    const data = await fs.readFile(pathsFile, 'utf8');
    pathsCache = JSON.parse(data);
    logger.info('Loaded paths data');
    return pathsCache;
  } catch (error) {
    logger.error('Failed to load paths.json', { error: error.message });
    throw error;
  }
}

/**
 * GET /paths
 * Returns all named paths
 */
router.get('/', optionalAuth, async (req, res) => {
  try {
    const paths = await loadPaths();
    res.json({ paths });
  } catch (error) {
    logger.error('Failed to get paths', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /paths/get
 * Returns a specific path by name
 */
router.get('/get', optionalAuth, async (req, res) => {
  const { name } = req.query;

  if (!name) {
    return res.status(400).json({ error: 'Path name required' });
  }

  try {
    const paths = await loadPaths();
    const path = paths.find(p => p.name === name);

    if (!path) {
      return res.status(404).json({ error: 'Path not found' });
    }

    res.json({ path });
  } catch (error) {
    logger.error('Failed to get path', { error: error.message, name });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
module.exports.loadPaths = loadPaths;
