const express = require('express');
const router = express.Router();
const { forumDb } = require('../config/database');
const { authenticateJWT } = require('../middleware/auth');
const logger = require('../config/logger');

/**
 * GET /shoutbox
 * Returns last 50 shoutbox messages from forum database
 */
router.get('/', authenticateJWT, async (req, res) => {
  try {
    const [messages] = await forumDb.query(
      `SELECT entryID, userID, username, time, message
       FROM wcf1_shoutbox_entry
       WHERE shoutboxID = 1
       ORDER BY time DESC
       LIMIT 50`
    );

    // Reverse to get chronological order (oldest first)
    const chronological = messages.reverse();

    res.json({ messages: chronological });

  } catch (error) {
    logger.error('Failed to get shoutbox messages', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /shoutbox
 * Posts a message to the shoutbox
 */
router.post('/', authenticateJWT, async (req, res) => {
  const { message } = req.body;

  if (!message || message.trim().length === 0) {
    return res.status(400).json({ error: 'Message required' });
  }

  if (message.length > 1000) {
    return res.status(400).json({ error: 'Message too long (max 1000 characters)' });
  }

  try {
    const timestamp = Math.floor(Date.now() / 1000);

    const [result] = await forumDb.query(
      `INSERT INTO wcf1_shoutbox_entry (shoutboxID, userID, username, time, message)
       VALUES (1, ?, ?, ?, ?)`,
      [req.user.userId, req.user.username, timestamp, message.trim()]
    );

    logger.info('Shoutbox message posted', { 
      userId: req.user.userId, 
      username: req.user.username,
      messageLength: message.length
    });

    res.json({ 
      success: true, 
      entryId: result.insertId,
      message: {
        entryID: result.insertId,
        userID: req.user.userId,
        username: req.user.username,
        time: timestamp,
        message: message.trim()
      }
    });

  } catch (error) {
    logger.error('Failed to post shoutbox message', { 
      error: error.message,
      userId: req.user.userId
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
