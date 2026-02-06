const { forumDb } = require('../config/database');
const logger = require('../config/logger');

// Track last processed shoutbox entry ID for polling
let lastShoutboxId = 0;

/**
 * Initialize shoutbox websocket handlers for a connected socket
 * @param {object} socket - Socket.io socket instance
 * @param {object} user - Authenticated user object { userId, username, realm }
 */
function initializeShoutboxHandlers(socket, user) {
  /**
   * Handle shoutbox get messages
   */
  socket.on('shoutbox:get', async (data, callback) => {
    try {
      // Only fetch the most recent 50 messages to limit payload size
      const [messages] = await forumDb.query(
        `SELECT entryID, userID, username, time, message
         FROM wcf1_shoutbox_entry
         WHERE shoutboxID = 1
         ORDER BY time DESC
         LIMIT 50`
      );

      // Reverse to get chronological order (oldest first)
      const chronological = messages.reverse();

      // Normalize keys to camelCase
      const msgs = chronological.map(m => ({
        entryId: m.entryID,
        userId: m.userID,
        username: m.username,
        time: m.time,
        message: m.message
      }));

      if (callback) {
        callback({ success: true, messages: msgs });
      }

      logger.info('Shoutbox messages retrieved', { 
        userId: user.userId,
        messageCount: messages.length
      });

    } catch (error) {
      logger.error('Failed to get shoutbox messages', { 
        error: error.message, 
        userId: user.userId 
      });
      if (callback) callback({ success: false, error: 'Failed to load messages' });
    }
  });

  /**
   * Handle shoutbox send messages
   */
  socket.on('shoutbox:send', async (data, callback) => {
    const { message } = data;

    if (!message || message.trim().length === 0) {
      if (callback) callback({ success: false, error: 'Message required' });
      return;
    }

    if (message.length > 1000) {
      if (callback) callback({ success: false, error: 'Message too long (max 1000 characters)' });
      return;
    }

    try {
      const timestamp = Math.floor(Date.now() / 1000);

      const [result] = await forumDb.query(
        `INSERT INTO wcf1_shoutbox_entry (shoutboxID, userID, username, time, message)
         VALUES (1, ?, ?, ?, ?)`,
        [user.userId, user.username, timestamp, message.trim()]
      );

      const messageData = {
        entryId: result.insertId,
        userId: user.userId,
        username: user.username,
        time: timestamp,
        message: message.trim()
      };

      // Broadcast to all clients except sender (they get it via callback)
      socket.broadcast.emit('shoutbox:message', messageData);

      // Update last shoutbox ID to prevent polling from re-sending this message
      if (result.insertId > lastShoutboxId) {
        lastShoutboxId = result.insertId;
      }

      if (callback) {
        callback({ success: true, message: messageData });
      }

      logger.info('Shoutbox message sent', { 
        userId: user.userId,
        username: user.username,
        messageLength: message.length
      });

    } catch (error) {
      logger.error('Failed to send shoutbox message', { 
        error: error.message, 
        userId: user.userId 
      });
      if (callback) callback({ success: false, error: 'Failed to send message' });
    }
  });
}

/**
 * Poll for new shoutbox messages every 1 second
 * Limit fetches to at most 50 messages per tick to avoid huge backfills.
 * @param {object} io - Socket.io server instance
 */
async function startShoutboxPolling(io) {
  try {
    // Initialize lastShoutboxId to the current max entryID so we don't
    // accidentally broadcast the entire history when the service starts.
    const [rows] = await forumDb.query(
      `SELECT MAX(entryID) as maxId FROM wcf1_shoutbox_entry WHERE shoutboxID = 1`
    );
    if (rows && rows.length > 0 && rows[0].maxId) {
      lastShoutboxId = rows[0].maxId;
    }

    logger.info('Shoutbox polling initialized', { lastShoutboxId });
  } catch (err) {
    logger.error('Failed to initialize lastShoutboxId', { error: err.message });
  }

  setInterval(async () => {
    try {
      const [messages] = await forumDb.query(
        `SELECT entryID, userID, username, time, message
         FROM wcf1_shoutbox_entry
         WHERE shoutboxID = 1 AND entryID > ?
         ORDER BY entryID ASC
         LIMIT 50`,
        [lastShoutboxId]
      );

      if (messages.length > 0) {
        // Update last ID
        lastShoutboxId = messages[messages.length - 1].entryID;

        // Broadcast each new message to all clients
        messages.forEach(msg => {
          io.emit('shoutbox:message', {
            entryId: msg.entryID,
            userId: msg.userID,
            username: msg.username,
            time: msg.time,
            message: msg.message
          });
        });

        logger.info('Broadcasted new shoutbox messages', { count: messages.length });
      }

    } catch (error) {
      logger.error('Failed to poll shoutbox messages', { error: error.message });
    }
  }, 1000); // Every 1 second
}

module.exports = {
  initializeShoutboxHandlers,
  startShoutboxPolling
};
