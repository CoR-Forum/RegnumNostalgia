const { forumDb, gameDb } = require('../config/database');
const logger = require('../config/logger');
const { getItemByTemplateKey, getCachedShoutboxMessages, setShoutboxMessages, addShoutboxMessage, getLastShoutboxId, setLastShoutboxId } = require('../config/cache');
const { isGM } = require('../utils/permissions');

/**
 * Resolve user ID from either user_id (number) or username (string)
 * @param {string|number} userIdentifier - User ID or username
 * @returns {Promise<{userId: number, username: string}|null>} - User info or null if not found
 */
async function resolveUser(userIdentifier) {
  try {
    // Check if it's a number (user_id)
    const parsedId = parseInt(userIdentifier, 10);
    
    if (!isNaN(parsedId) && parsedId > 0 && parsedId.toString() === userIdentifier.toString()) {
      // It's a valid user_id
      const [rows] = await gameDb.query(
        'SELECT user_id, username FROM players WHERE user_id = ?',
        [parsedId]
      );
      
      if (rows.length > 0) {
        return { userId: rows[0].user_id, username: rows[0].username };
      }
    } else {
      // It's a username
      const [rows] = await gameDb.query(
        'SELECT user_id, username FROM players WHERE username = ?',
        [userIdentifier]
      );
      
      if (rows.length > 0) {
        return { userId: rows[0].user_id, username: rows[0].username };
      }
    }
    
    return null;
  } catch (error) {
    logger.error('Failed to resolve user', { error: error.message, userIdentifier });
    return null;
  }
}

/**
 * Handle the /item command to give items to users
 * @param {object} socket - Socket.io socket instance
 * @param {object} user - User executing the command
 * @param {string} templateKey - The item template key
 * @param {string|number} targetUserIdentifier - The user ID or username to receive the item
 * @param {number} quantity - The quantity of items to give (default: 1)
 */
async function handleItemAddCommand(socket, user, templateKey, targetUserIdentifier, quantity: any = 1) {
  try {
    // Validate inputs
    if (!templateKey || !targetUserIdentifier) {
      return { success: false, error: 'Usage: /item <template_key> <user_id|username> [quantity]' };
    }

    const parsedQuantity = parseInt(String(quantity), 10) || 1;

    if (parsedQuantity <= 0 || parsedQuantity > 10000) {
      return { success: false, error: 'Quantity must be between 1 and 10000' };
    }

    // Resolve user ID from identifier (can be user_id or username)
    const targetUser = await resolveUser(targetUserIdentifier);
    
    if (!targetUser) {
      return { success: false, error: `User '${targetUserIdentifier}' not found` };
    }

    const parsedUserId = targetUser.userId;
    const targetUsername = targetUser.username;

    // Look up item by template_key (cached in Redis)
    const itemData = await getItemByTemplateKey(gameDb, templateKey);

    if (!itemData) {
      return { success: false, error: `Item '${templateKey}' not found` };
    }

    const itemId = itemData.item_id;
    const itemName = itemData.name;
    const isStackable = itemData.stackable;

    // Add item to inventory
    if (!isStackable && parsedQuantity > 1) {
      // For non-stackable items with quantity > 1, add multiple entries
      for (let i = 0; i < parsedQuantity; i++) {
        await gameDb.query(
          'INSERT INTO inventory (user_id, item_id, quantity, acquired_at) VALUES (?, ?, 1, UNIX_TIMESTAMP())',
          [parsedUserId, itemId]
        );
      }
    } else if (!isStackable) {
      // Non-stackable, single item
      await gameDb.query(
        'INSERT INTO inventory (user_id, item_id, quantity, acquired_at) VALUES (?, ?, 1, UNIX_TIMESTAMP())',
        [parsedUserId, itemId]
      );
    } else {
      // Stackable item - check if user already has it
      const [existingStack] = await gameDb.query(
        'SELECT inventory_id, quantity FROM inventory WHERE user_id = ? AND item_id = ?',
        [parsedUserId, itemId]
      );

      if (existingStack.length > 0) {
        // Update existing stack
        const newQuantity = existingStack[0].quantity + parsedQuantity;
        await gameDb.query(
          'UPDATE inventory SET quantity = ? WHERE inventory_id = ?',
          [newQuantity, existingStack[0].inventory_id]
        );
      } else {
        // Create new stack
        await gameDb.query(
          'INSERT INTO inventory (user_id, item_id, quantity, acquired_at) VALUES (?, ?, ?, UNIX_TIMESTAMP())',
          [parsedUserId, itemId, parsedQuantity]
        );
      }
    }

    logger.info('GM gave item via command', {
      gmUserId: user.userId,
      gmUsername: user.username,
      targetUserId: parsedUserId,
      targetUsername,
      itemId,
      itemName,
      templateKey,
      quantity: parsedQuantity
    });

    // Notify target user if they're connected to reload their inventory
    const targetSocket: any = Array.from(socket.nsp.sockets.values())
      .find((s: any) => s.user && s.user.userId === parsedUserId);

    if (targetSocket) {
      // Trigger inventory reload for target user
      targetSocket.emit('inventory:refresh');
      logger.info('Sent inventory reload to target user', { targetUserId: parsedUserId });
    }

    return {
      success: true,
      message: `Gave ${parsedQuantity}x ${itemName} (${templateKey}) to ${targetUsername} (ID: ${parsedUserId})`
    };

  } catch (error) {
    logger.error('Failed to execute /item command', {
      error: error.message,
      userId: user.userId,
      templateKey,
      targetUserId: targetUserIdentifier
    });
    return { success: false, error: 'Failed to give item' };
  }
}

/**
 * Handle the /itemrem command to remove items from users
 * @param {object} socket - Socket.io socket instance
 * @param {object} user - User executing the command
 * @param {string} templateKey - The item template key
 * @param {string|number} targetUserIdentifier - The user ID or username to lose the item
 * @param {number} quantity - The quantity of items to remove (default: 1)
 */
async function handleItemRemoveCommand(socket, user, templateKey, targetUserIdentifier, quantity: any = 1) {
  try {
    // Validate inputs
    if (!templateKey || !targetUserIdentifier) {
      return { success: false, error: 'Usage: /itemrem <template_key> <user_id|username> [quantity]' };
    }

    const parsedQuantity = parseInt(String(quantity), 10) || 1;

    if (parsedQuantity <= 0 || parsedQuantity > 10000) {
      return { success: false, error: 'Quantity must be between 1 and 10000' };
    }

    // Resolve user ID from identifier (can be user_id or username)
    const targetUser = await resolveUser(targetUserIdentifier);
    
    if (!targetUser) {
      return { success: false, error: `User '${targetUserIdentifier}' not found` };
    }

    const parsedUserId = targetUser.userId;
    const targetUsername = targetUser.username;

    // Look up item by template_key (cached in Redis)
    const itemData = await getItemByTemplateKey(gameDb, templateKey);

    if (!itemData) {
      return { success: false, error: `Item '${templateKey}' not found` };
    }

    const itemId = itemData.item_id;
    const itemName = itemData.name;
    const isStackable = itemData.stackable;

    // Check what the user has in inventory
    const [inventoryRows] = await gameDb.query(
      'SELECT inventory_id, quantity FROM inventory WHERE user_id = ? AND item_id = ? ORDER BY acquired_at ASC',
      [parsedUserId, itemId]
    );

    if (inventoryRows.length === 0) {
      return { success: false, error: `${targetUsername} doesn't have any ${itemName}` };
    }

    let removedCount = 0;

    if (!isStackable) {
      // Remove individual entries for non-stackable items
      const toRemove = Math.min(parsedQuantity, inventoryRows.length);
      for (let i = 0; i < toRemove; i++) {
        await gameDb.query(
          'DELETE FROM inventory WHERE inventory_id = ?',
          [inventoryRows[i].inventory_id]
        );
        removedCount++;
      }
    } else {
      // Handle stackable items
      const stack = inventoryRows[0];
      const currentQuantity = stack.quantity;

      if (parsedQuantity >= currentQuantity) {
        // Remove entire stack
        await gameDb.query(
          'DELETE FROM inventory WHERE inventory_id = ?',
          [stack.inventory_id]
        );
        removedCount = currentQuantity;
      } else {
        // Reduce stack quantity
        await gameDb.query(
          'UPDATE inventory SET quantity = quantity - ? WHERE inventory_id = ?',
          [parsedQuantity, stack.inventory_id]
        );
        removedCount = parsedQuantity;
      }
    }

    logger.info('GM removed item via command', {
      gmUserId: user.userId,
      gmUsername: user.username,
      targetUserId: parsedUserId,
      targetUsername,
      itemId,
      itemName,
      templateKey,
      quantity: removedCount
    });

    // Notify target user if they're connected to reload their inventory
    const targetSocket: any = Array.from(socket.nsp.sockets.values())
      .find((s: any) => s.user && s.user.userId === parsedUserId);

    if (targetSocket) {
      targetSocket.emit('inventory:refresh');
      logger.info('Sent inventory reload to target user', { targetUserId: parsedUserId });
    }

    return {
      success: true,
      message: `Removed ${removedCount}x ${itemName} (${templateKey}) from ${targetUsername} (ID: ${parsedUserId})`
    };

  } catch (error) {
    logger.error('Failed to execute /itemrem command', {
      error: error.message,
      userId: user.userId,
      templateKey,
      targetUserId: targetUserIdentifier
    });
    return { success: false, error: 'Failed to remove item' };
  }
}

/**
 * Parse and execute a command from a shoutbox message
 * @param {object} socket - Socket.io socket instance
 * @param {object} user - User executing the command
 * @param {string} message - The command message
 * @returns {Promise<object>} - Result of command execution
 */
async function executeCommand(socket, user, message) {
  const parts = message.trim().split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (command) {
    case '/item':
    case '/itemadd':
      const [templateKey, targetUserId, quantity] = args;
      return await handleItemAddCommand(socket, user, templateKey, targetUserId, quantity);
    
    case '/itemrem':
    case '/itemremove':
      const [remTemplateKey, remTargetUserId, remQuantity] = args;
      return await handleItemRemoveCommand(socket, user, remTemplateKey, remTargetUserId, remQuantity);
    
    default:
      return { success: false, error: `Unknown command: ${command}` };
  }
}

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
      // Try Redis cache first
      let msgs = await getCachedShoutboxMessages();

      if (msgs) {
        // Cache stores messages in chronological order (oldest first) — use as-is
      } else {
        // Cache miss - fetch from DB and populate cache
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
        msgs = chronological.map(m => ({
          entryId: m.entryID,
          userId: m.userID,
          username: m.username,
          time: m.time,
          message: m.message
        }));

        // Populate cache (expects chronological order)
        await setShoutboxMessages(msgs);
      }

      if (callback) {
        callback({ success: true, messages: msgs });
      }

      logger.info('Shoutbox messages retrieved', { 
        userId: user.userId,
        messageCount: msgs.length
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

    // Check if message is a command
    if (message.trim().startsWith('/')) {
      // Check if user has GM permissions
      const hasGMPermission = await isGM(user.userId);
      
      if (!hasGMPermission) {
        if (callback) {
          callback({ success: false, error: 'You do not have permission to use commands' });
        }
        return;
      }

      // Execute the command
      const result = await executeCommand(socket, user, message.trim());
      
      if (callback) {
        callback(result);
      }

      // If command was successful, broadcast a system message to shoutbox
      if (result.success && result.message) {
        const timestamp = Math.floor(Date.now() / 1000);
        const composed = `[GM ${user.username}] ${result.message}`;

        try {
          // Persist system message into the shoutbox table with userID 0
          const [res] = await forumDb.query(
            `INSERT INTO wcf1_shoutbox_entry (shoutboxID, userID, username, time, message)
             VALUES (1, 0, ?, ?, ?)`,
            ['System', timestamp, composed]
          );

          const systemMessage = {
            entryId: res.insertId,
            userId: 0,
            username: 'System',
            time: timestamp,
            message: composed
          };

          // Fill the gap: any forum messages that arrived between currentLastId
          // and this insertId would be permanently skipped by the poller if we
          // just jump lastShoutboxId to res.insertId directly.
          const currentLastId = await getLastShoutboxId();
          if (res.insertId > currentLastId + 1) {
            const [gapMsgs] = await forumDb.query(
              `SELECT entryID, userID, username, time, message
               FROM wcf1_shoutbox_entry
               WHERE shoutboxID = 1 AND entryID > ? AND entryID < ?
               ORDER BY entryID ASC`,
              [currentLastId, res.insertId]
            );
            for (const gm of gapMsgs) {
              const gapData = {
                entryId: gm.entryID,
                userId: gm.userID,
                username: gm.username,
                time: gm.time,
                message: gm.message
              };
              await addShoutboxMessage(gapData);
              socket.nsp.emit('shoutbox:message', gapData);
            }
          }
          if (res.insertId > currentLastId) await setLastShoutboxId(res.insertId);

          // Add to Redis cache
          await addShoutboxMessage(systemMessage);

          // Broadcast to all clients including sender
          socket.nsp.emit('shoutbox:message', systemMessage);

          logger.info('GM command executed and broadcast', {
            gmUserId: user.userId,
            gmUsername: user.username,
            command: message.trim(),
            shoutboxEntryId: res.insertId
          });

        } catch (err) {
          // Fallback: broadcast without DB persistence
          const fallback = {
            entryId: 0,
            userId: 0,
            username: 'System',
            time: timestamp,
            message: composed
          };
          socket.nsp.emit('shoutbox:message', fallback);
          logger.error('Failed to persist system shoutbox message', { error: err.message });
        }
      }

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

      // Add to Redis cache
      await addShoutboxMessage(messageData);

      // Update last shoutbox ID BEFORE broadcasting to prevent the poller
      // from picking up this message and broadcasting it a second time.
      // Also fill any gap caused by forum messages that arrived between the
      // previous lastShoutboxId and this insertId — without this, forum
      // messages in the gap are permanently skipped by the poller.
      const currentLastId = await getLastShoutboxId();
      if (result.insertId > currentLastId + 1) {
        const [gapMsgs] = await forumDb.query(
          `SELECT entryID, userID, username, time, message
           FROM wcf1_shoutbox_entry
           WHERE shoutboxID = 1 AND entryID > ? AND entryID < ?
           ORDER BY entryID ASC`,
          [currentLastId, result.insertId]
        );
        for (const gm of gapMsgs) {
          const gapData = {
            entryId: gm.entryID,
            userId: gm.userID,
            username: gm.username,
            time: gm.time,
            message: gm.message
          };
          await addShoutboxMessage(gapData);
          socket.nsp.emit('shoutbox:message', gapData);
        }
      }
      if (result.insertId > currentLastId) {
        await setLastShoutboxId(result.insertId);
      }

      // Broadcast to all clients except sender (they get it via callback)
      socket.broadcast.emit('shoutbox:message', messageData);

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
    // Check if we have a persisted lastShoutboxId in Redis
    let lastId = await getLastShoutboxId();

    if (!lastId) {
      // Initialize lastShoutboxId to the current max entryID so we don't
      // accidentally broadcast the entire history when the service starts.
      const [rows] = await forumDb.query(
        `SELECT MAX(entryID) as maxId FROM wcf1_shoutbox_entry WHERE shoutboxID = 1`
      );
      if (rows && rows.length > 0 && rows[0].maxId) {
        lastId = rows[0].maxId;
        await setLastShoutboxId(lastId);
      }
    }

    logger.info('Shoutbox polling initialized', { lastShoutboxId: lastId });
  } catch (err) {
    logger.error('Failed to initialize lastShoutboxId', { error: err.message });
  }

  setInterval(async () => {
    try {
      const lastShoutboxId = await getLastShoutboxId();

      const [messages] = await forumDb.query(
        `SELECT entryID, userID, username, time, message
         FROM wcf1_shoutbox_entry
         WHERE shoutboxID = 1 AND entryID > ?
         ORDER BY entryID ASC
         LIMIT 50`,
        [lastShoutboxId]
      );

      if (messages.length > 0) {
        // Update last ID in Redis
        const newLastId = messages[messages.length - 1].entryID;
        await setLastShoutboxId(newLastId);

        // Broadcast each new message to all clients and add to cache
        for (const msg of messages) {
          const messageData = {
            entryId: msg.entryID,
            userId: msg.userID,
            username: msg.username,
            time: msg.time,
            message: msg.message
          };

          await addShoutboxMessage(messageData);
          io.emit('shoutbox:message', messageData);
        }

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
