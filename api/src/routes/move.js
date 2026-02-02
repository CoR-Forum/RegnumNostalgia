const express = require('express');
const router = express.Router();
const { authenticateJWT } = require('../middleware/auth');
const { findPath, createWalker } = require('../services/pathfinding');
const logger = require('../config/logger');

/**
 * POST /player/move
 * Initiates server-side pathfinding and creates a walker job
 */
router.post('/move', authenticateJWT, async (req, res) => {
  const { x, y } = req.body;

  if (typeof x !== 'number' || typeof y !== 'number') {
    return res.status(400).json({ error: 'Invalid coordinates' });
  }

  if (!req.user.realm) {
    return res.status(400).json({ error: 'Realm not selected' });
  }

  try {
    // Find path using Dijkstra algorithm
    const positions = await findPath(req.user.userId, x, y, req.user.realm);

    // Create walker job
    const walker = await createWalker(req.user.userId, positions);

    logger.info('Movement started', {
      userId: req.user.userId,
      destination: { x, y },
      steps: positions.length
    });

    res.json({
      success: true,
      message: 'Walking started',
      steps: positions.length,
      walker
    });

  } catch (error) {
    logger.error('Movement failed', {
      error: error.message,
      userId: req.user.userId,
      destination: { x, y }
    });
    
    if (error.message.includes('cannot') || error.message.includes('swim')) {
      return res.status(403).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Failed to calculate path' });
  }
});

module.exports = router;
