const Bull = require('bull');
const { redis, gameDb } = require('../config/database');
const { QUEUE_INTERVALS, BULL_JOB_OPTIONS, COLLECTABLE_CONFIG, LOOT_TABLES } = require('../config/constants');
const logger = require('../config/logger');
const { addPlayerLog } = require('../sockets');

let io = null; // Socket.io instance, injected later
// Track last-known region id per user for walker-based movement
const userRegions = new Map();

/**
 * Simple point-in-polygon test (ray-casting)
 * polygon: array of [x,y] points
 */
function pointInPolygon(px, py, polygon) {
  if (!Array.isArray(polygon) || polygon.length === 0) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / (yj - yi + 0.0) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Calculate distance between two points
 */
function distance(x1, y1, x2, y2) {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Resolve loot table and return items to give
 * Returns array of { itemId, quantity }
 */
async function resolveLootTable(lootTableKey) {
  const lootTable = LOOT_TABLES[lootTableKey];
  if (!lootTable) {
    logger.warn(`Loot table not found: ${lootTableKey}`);
    return [];
  }

  const rewards = [];

  if (lootTable.mode === 'weighted') {
    // Pick ONE item from pool using weights
    const totalWeight = lootTable.pool.reduce((sum, item) => sum + item.weight, 0);
    let roll = Math.random() * totalWeight;
    let selectedItem = null;

    for (const item of lootTable.pool) {
      roll -= item.weight;
      if (roll <= 0) {
        selectedItem = item;
        break;
      }
    }

    if (!selectedItem) selectedItem = lootTable.pool[0];

    // Get item_id from template_key
    const [rows] = await gameDb.query(
      'SELECT item_id FROM items WHERE template_key = ?',
      [selectedItem.item]
    );

    if (rows.length > 0) {
      const [minQty, maxQty] = selectedItem.quantity;
      const quantity = Math.floor(Math.random() * (maxQty - minQty + 1)) + minQty;
      rewards.push({ itemId: rows[0].item_id, templateKey: selectedItem.item, quantity });
    }

  } else if (lootTable.mode === 'multi-drop') {
    // Pick N times from pool
    const dropCount = lootTable.drops || 1;
    for (let i = 0; i < dropCount; i++) {
      const totalWeight = lootTable.pool.reduce((sum, item) => sum + item.weight, 0);
      let roll = Math.random() * totalWeight;
      let selectedItem = null;

      for (const item of lootTable.pool) {
        roll -= item.weight;
        if (roll <= 0) {
          selectedItem = item;
          break;
        }
      }

      if (!selectedItem) selectedItem = lootTable.pool[0];

      const [rows] = await gameDb.query(
        'SELECT item_id FROM items WHERE template_key = ?',
        [selectedItem.item]
      );

      if (rows.length > 0) {
        const [minQty, maxQty] = selectedItem.quantity;
        const quantity = Math.floor(Math.random() * (maxQty - minQty + 1)) + minQty;
        rewards.push({ itemId: rows[0].item_id, templateKey: selectedItem.item, quantity });
      }
    }

  } else if (lootTable.mode === 'independent') {
    // Each item rolls independently
    for (const item of lootTable.pool) {
      const totalWeight = lootTable.pool.reduce((sum, i) => sum + i.weight, 0);
      const roll = Math.random() * totalWeight;

      if (roll <= item.weight) {
        const [rows] = await gameDb.query(
          'SELECT item_id FROM items WHERE template_key = ?',
          [item.item]
        );

        if (rows.length > 0) {
          const [minQty, maxQty] = item.quantity;
          const quantity = Math.floor(Math.random() * (maxQty - minQty + 1)) + minQty;
          rewards.push({ itemId: rows[0].item_id, templateKey: item.item, quantity });
        }
      }
    }
  }

  return rewards;
}

/**
 * Add item to player inventory
 */
async function addToInventory(userId, itemId, quantity) {
  const now = Math.floor(Date.now() / 1000);

  // Check if item is stackable and already exists in inventory
  const [itemInfo] = await gameDb.query(
    'SELECT stackable FROM items WHERE item_id = ?',
    [itemId]
  );

  if (itemInfo.length === 0) {
    logger.warn(`Item not found: ${itemId}`);
    return null;
  }

  if (itemInfo[0].stackable) {
    // Try to stack with existing item
    const [existing] = await gameDb.query(
      'SELECT inventory_id, quantity FROM inventory WHERE user_id = ? AND item_id = ?',
      [userId, itemId]
    );

    if (existing.length > 0) {
      // Update existing stack
      await gameDb.query(
        'UPDATE inventory SET quantity = quantity + ? WHERE inventory_id = ?',
        [quantity, existing[0].inventory_id]
      );
      return existing[0].inventory_id;
    }
  }

  // Create new inventory entry
  const [result] = await gameDb.query(
    'INSERT INTO inventory (user_id, item_id, quantity, acquired_at) VALUES (?, ?, ?, ?)',
    [userId, itemId, quantity, now]
  );

  return result.insertId;
}

/**
 * Set Socket.io instance for emitting events
 */
function setSocketIO(socketIO) {
  io = socketIO;
}

/**
 * Walker Queue - Processes walker movements every 2 seconds
 */
const walkerQueue = new Bull('walker-processor', {
  redis: {
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT || '6379')
  },
  defaultJobOptions: BULL_JOB_OPTIONS
});

walkerQueue.process('process-walkers', async (job) => {
  try {
    // Get all active walkers
    const [walkers] = await gameDb.query(
      `SELECT walker_id, user_id, positions, current_index, status, collecting_x, collecting_y, collecting_spawn_id
       FROM walkers
       WHERE status = 'walking'`
    );

    if (walkers.length === 0) {
      return { processed: 0 };
    }

    const now = Math.floor(Date.now() / 1000);
    let processed = 0;

    for (const walker of walkers) {
      const positions = typeof walker.positions === 'string' ?
        JSON.parse(walker.positions) : walker.positions;

      const nextIndex = walker.current_index + 1;

      if (nextIndex >= positions.length) {
        // Walker has reached destination
        
        // Check if we need to collect an item
        if (walker.collecting_spawn_id && walker.collecting_x !== null && walker.collecting_y !== null) {
          const finalPos = positions[positions.length - 1];
          const dist = distance(finalPos[0], finalPos[1], walker.collecting_x, walker.collecting_y);

          if (dist <= COLLECTABLE_CONFIG.PICKUP_RADIUS) {
            // Within pickup range - attempt collection
            try {
              // Atomic check and mark as collected (first-arrival wins)
              const [updateResult] = await gameDb.query(
                `UPDATE spawned_items 
                 SET collected_at = ?, collected_by = ?
                 WHERE spawn_id = ? AND collected_at IS NULL`,
                [now, walker.user_id, walker.collecting_spawn_id]
              );

              if (updateResult.affectedRows > 0) {
                // Successfully collected!
                
                // Get spawn details to resolve loot
                const [spawnDetails] = await gameDb.query(
                  `SELECT item_id, type, loot_table_key, x, y, visual_icon FROM spawned_items WHERE spawn_id = ?`,
                  [walker.collecting_spawn_id]
                );

                if (spawnDetails.length > 0) {
                  const spawn = spawnDetails[0];
                  const itemsCollected = [];

                  if (spawn.type === 'standard') {
                    // Standard item - just add it
                    if (spawn.item_id) {
                      const inventoryId = await addToInventory(walker.user_id, spawn.item_id, 1);
                      
                      // Get item details for notification
                      const [itemData] = await gameDb.query(
                        'SELECT template_key, name, icon_name FROM items WHERE item_id = ?',
                        [spawn.item_id]
                      );

                      if (itemData.length > 0) {
                        itemsCollected.push({
                          ...itemData[0],
                          quantity: 1,
                          inventoryId
                        });
                      }
                    }
                  } else if (spawn.type === 'loot-container') {
                    // Resolve loot table
                    const rewards = await resolveLootTable(spawn.loot_table_key);
                    
                    for (const reward of rewards) {
                      const inventoryId = await addToInventory(walker.user_id, reward.itemId, reward.quantity);
                      
                      // Get item details
                      const [itemData] = await gameDb.query(
                        'SELECT template_key, name, icon_name FROM items WHERE item_id = ?',
                        [reward.itemId]
                      );

                      if (itemData.length > 0) {
                        itemsCollected.push({
                          ...itemData[0],
                          quantity: reward.quantity,
                          inventoryId
                        });
                      }
                    }
                  }

                  // Emit individual item-added events to the collecting player
                  if (io) {
                    const sockets = io.sockets && io.sockets.sockets ? Array.from(io.sockets.sockets.values()) : [];
                    const userSocket = sockets.find(s => s && s.user && s.user.userId === walker.user_id);

                    if (userSocket) {
                      for (const item of itemsCollected) {
                        userSocket.emit('inventory:item-added', {
                          templateKey: item.template_key,
                          name: item.name,
                          iconName: item.icon_name,
                          quantity: item.quantity,
                          inventoryId: item.inventoryId
                        });
                      }
                    } else {
                      logger.warn(`User socket not found for userId ${walker.user_id} - toast notification may not show`);
                    }

                    // Broadcast collection to all clients to remove marker
                    io.emit('collectable:collected', {
                      spawnId: walker.collecting_spawn_id,
                      userId: walker.user_id,
                      items: itemsCollected.map(i => ({
                        name: i.name,
                        quantity: i.quantity,
                        templateKey: i.template_key,
                        iconName: i.icon_name
                      }))
                    });

                    // Play collection sound for the collecting player
                    if (userSocket) {
                      const settings = userSocket.user && userSocket.user.settings;
                      if (settings && settings.soundsEnabled && settings.collectionSoundsEnabled) {
                        const volume = typeof settings.collectionSoundsVolume === 'number' 
                          ? settings.collectionSoundsVolume 
                          : parseFloat(settings.collectionSoundsVolume) || 1.0;
                        userSocket.emit('audio:play', {
                          type: 'sfx',
                          file: 'notification.ogg',
                          volume: volume,
                          loop: false
                        });
                      }
                    }

                    // Add log messages for collected items
                    for (const item of itemsCollected) {
                      const logMessage = item.quantity > 1 
                        ? `Collected ${item.quantity}x ${item.name}`
                        : `Collected ${item.name}`;
                      await addPlayerLog(walker.user_id, logMessage, 'success', io);
                    }
                  }

                  logger.debug(`User ${walker.user_id} collected spawn ${walker.collecting_spawn_id}, received ${itemsCollected.length} items`);
                }
              } else {
                // Item already collected by someone else
                if (io) {
                  const sockets = io.sockets && io.sockets.sockets ? Array.from(io.sockets.sockets.values()) : [];
                  const userSocket = sockets.find(s => s && s.user && s.user.userId === walker.user_id);

                  if (userSocket) {
                    userSocket.emit('collectable:failed', {
                      spawnId: walker.collecting_spawn_id,
                      reason: 'already_collected'
                    });
                  }

                  // Add log message for failed collection
                  await addPlayerLog(walker.user_id, 'Item already collected by another player', 'warning', io);
                }
                logger.debug(`User ${walker.user_id} failed to collect spawn ${walker.collecting_spawn_id} - already collected`);
              }
            } catch (collectErr) {
              logger.error(`Error collecting item for user ${walker.user_id}:`, collectErr);
            }
          } else {
            // Not within pickup range
            logger.warn(`User ${walker.user_id} reached destination but not within pickup range (${dist.toFixed(1)}px from target)`);
          }
        }

        // Mark walker as done
        await gameDb.query(
          `UPDATE walkers SET status = 'done', finished_at = ?, updated_at = ?
           WHERE walker_id = ?`,
          [now, now, walker.walker_id]
        );

        // Emit walker completed event
        if (io) {
          io.emit('walker:completed', {
            userId: walker.user_id,
            walkerId: walker.walker_id
          });
        }

        processed++;
        continue;
      }

      // Advance walker to next position
      const newPos = positions[nextIndex];
      await gameDb.query(
        `UPDATE walkers SET current_index = ?, updated_at = ?
         WHERE walker_id = ?`,
        [nextIndex, now, walker.walker_id]
      );

      // Update player position
      await gameDb.query(
        'UPDATE players SET x = ?, y = ?, last_active = UNIX_TIMESTAMP() WHERE user_id = ?',
        [newPos[0], newPos[1], walker.user_id]
      );

      // Emit walker step event to all clients (for player visibility)
      if (io) {
        io.emit('walker:step', {
          userId: walker.user_id,
          walkerId: walker.walker_id,
          currentIndex: nextIndex,
          position: { x: newPos[0], y: newPos[1] },
          totalSteps: positions.length,
          completed: false
        });

        // Also emit position update for real-time player tracking
        io.emit('players:position', [{
          userId: walker.user_id,
          x: newPos[0],
          y: newPos[1]
        }]);

        // Handle region change for this user (walker moved)
        try {
          const regions = require('../../gameData/regions.json');
          const prevRegionId = userRegions.get(walker.user_id) || null;
          const matched = regions.find(r => Array.isArray(r.coordinates) && pointInPolygon(newPos[0], newPos[1], r.coordinates));
          const newRegionId = matched ? (matched.id || null) : null;

          if (newRegionId !== prevRegionId) {
            userRegions.set(walker.user_id, newRegionId);

            // Find the socket for this user (if connected)
            let targetSocket = null;
            try {
              const sockets = io.sockets && io.sockets.sockets ? Array.from(io.sockets.sockets.values()) : [];
              for (const s of sockets) {
                if (s && s.user && s.user.userId === walker.user_id) {
                  targetSocket = s;
                  break;
                }
              }
            } catch (e) {
              targetSocket = null;
            }

            if (targetSocket) {
              // Always request stop for previous music to be safe
              if (prevRegionId) {
                try { targetSocket.emit('audio:stop', { type: 'music', regionId: prevRegionId }); } catch (e) {}
              }

              // Play new music only if user enabled music
              try {
                const settings = targetSocket.user && targetSocket.user.settings ? targetSocket.user.settings : null;
                if (matched && matched.music && settings && settings.musicEnabled) {
                  const vol = typeof settings.musicVolume === 'number' ? settings.musicVolume : parseFloat(settings.musicVolume) || 0.6;
                  targetSocket.emit('audio:play', {
                    type: 'music',
                    file: matched.music,
                    volume: vol,
                    loop: true,
                    regionId: newRegionId
                  });
                }
              } catch (e) {
                // ignore
              }
            }
          }
        } catch (e) {
          logger.error('Failed to handle region change for walker', { error: e && e.message ? e.message : String(e), userId: walker.user_id });
        }
      }

      processed++;
    }

    return { processed };

  } catch (error) {
    logger.error('Walker queue error', { error: error.message });
    throw error;
  }
});

walkerQueue.on('completed', (job, result) => {
  logger.debug('Walker queue completed', result);
});

walkerQueue.on('failed', (job, err) => {
  logger.error('Walker queue failed', { error: err.message });
});

/**
 * Initialize walker queue with repeatable job
 */
async function initWalkerQueue() {
  await walkerQueue.add(
    'process-walkers',
    {},
    {
      repeat: {
        every: QUEUE_INTERVALS.WALKER
      },
      ...BULL_JOB_OPTIONS
    }
  );
  logger.info('Walker queue initialized', { interval: `${QUEUE_INTERVALS.WALKER}ms` });
}

module.exports = {
  walkerQueue,
  initWalkerQueue,
  setSocketIO,
  resolveLootTable,
  addToInventory
};
