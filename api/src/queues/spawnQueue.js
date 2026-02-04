const Bull = require('bull');
const { gameDb } = require('../config/database');
const logger = require('../config/logger');
const {
  QUEUE_INTERVALS,
  BULL_JOB_OPTIONS,
  COLLECTABLE_CONFIG,
  LOOT_TABLES,
  FIXED_SPAWN_POINTS,
  REGION_SPAWN_RULES
} = require('../config/constants');

const regionsData = require('../../gameData/regions.json');

let spawnQueue = null;
let io = null;

/**
 * Point-in-polygon test using ray casting algorithm
 */
function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];

    const intersect = ((yi > y) !== (yj > y)) && 
                      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Calculate minimum distance from point to polygon edges
 */
function minDistanceToEdge(x, y, polygon) {
  let minDist = Infinity;
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const x1 = polygon[j][0];
    const y1 = polygon[j][1];
    const x2 = polygon[i][0];
    const y2 = polygon[i][1];
    
    // Calculate distance from point to line segment
    const A = x - x1;
    const B = y - y1;
    const C = x2 - x1;
    const D = y2 - y1;
    
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    
    if (lenSq !== 0) {
      param = dot / lenSq;
    }
    
    let xx, yy;
    
    if (param < 0) {
      xx = x1;
      yy = y1;
    } else if (param > 1) {
      xx = x2;
      yy = y2;
    } else {
      xx = x1 + param * C;
      yy = y1 + param * D;
    }
    
    const dx = x - xx;
    const dy = y - yy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    minDist = Math.min(minDist, dist);
  }
  
  return minDist;
}

/**
 * Get random point within a polygon using rejection sampling
 * Ensures point is at least 10 pixels away from edges
 */
function getRandomPointInPolygon(polygon) {
  if (polygon.length === 0) return null;

  const MIN_DISTANCE_FROM_EDGE = 10;

  // Find bounding box
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  
  for (const [x, y] of polygon) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  // Try up to 100 times to find a valid point
  for (let attempt = 0; attempt < 100; attempt++) {
    const x = Math.floor(Math.random() * (maxX - minX + 1)) + minX;
    const y = Math.floor(Math.random() * (maxY - minY + 1)) + minY;
    
    if (pointInPolygon(x, y, polygon)) {
      const distToEdge = minDistanceToEdge(x, y, polygon);
      if (distToEdge >= MIN_DISTANCE_FROM_EDGE) {
        return { x, y };
      }
    }
  }

  // Fallback to centroid if rejection sampling fails
  const centroidX = Math.floor(polygon.reduce((sum, p) => sum + p[0], 0) / polygon.length);
  const centroidY = Math.floor(polygon.reduce((sum, p) => sum + p[1], 0) / polygon.length);
  return { x: centroidX, y: centroidY };
}

/**
 * Get item_id from template_key
 */
async function getItemId(templateKey) {
  const [rows] = await gameDb.query(
    'SELECT item_id FROM items WHERE template_key = ?',
    [templateKey]
  );
  return rows.length > 0 ? rows[0].item_id : null;
}

/**
 * Spawn item at fixed spawn point
 */
async function spawnFixedPoint(spawnPoint, now) {
  try {
    // Check if spawn point already has active spawn
    const [existing] = await gameDb.query(
      'SELECT spawn_id FROM spawned_items WHERE spawn_point_id = ? AND collected_at IS NULL',
      [spawnPoint.id]
    );

    if (existing.length > 0) {
      return; // Already spawned
    }

    // Check if respawn timer has elapsed for collected items
    const [lastCollected] = await gameDb.query(
      'SELECT collected_at FROM spawned_items WHERE spawn_point_id = ? AND collected_at IS NOT NULL ORDER BY collected_at DESC LIMIT 1',
      [spawnPoint.id]
    );

    if (lastCollected.length > 0) {
      const timeSinceCollected = now - lastCollected[0].collected_at;
      if (timeSinceCollected < spawnPoint.respawnTime) {
        return; // Still on cooldown
      }
    }

    let itemId = null;
    let lootTableKey = null;

    if (spawnPoint.type === 'standard') {
      // Standard item spawn
      itemId = await getItemId(spawnPoint.item);
      if (!itemId) {
        logger.warn(`Item not found for spawn point ${spawnPoint.id}: ${spawnPoint.item}`);
        return;
      }
    } else if (spawnPoint.type === 'loot-container') {
      // Loot container
      lootTableKey = spawnPoint.lootTable;
      if (!LOOT_TABLES[lootTableKey]) {
        logger.warn(`Loot table not found: ${lootTableKey}`);
        return;
      }
    }

    // Spawn the item
    const [result] = await gameDb.query(
      `INSERT INTO spawned_items (item_id, x, y, realm, type, loot_table_key, spawn_point_id, visual_icon, spawned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [itemId, spawnPoint.x, spawnPoint.y, spawnPoint.realm, spawnPoint.type, lootTableKey, spawnPoint.id, spawnPoint.visual, now]
    );

    logger.debug(`Spawned fixed point: ${spawnPoint.id} at (${spawnPoint.x}, ${spawnPoint.y})`);

    // Broadcast to clients
    if (io) {
      io.emit('collectable:spawned', {
        spawnId: result.insertId,
        x: spawnPoint.x,
        y: spawnPoint.y,
        realm: spawnPoint.realm,
        visualIcon: spawnPoint.visual,
        type: spawnPoint.type
      });
    }
  } catch (err) {
    logger.error(`Error spawning fixed point ${spawnPoint.id}:`, err);
  }
}

/**
 * Spawn items in regions based on spawn rules
 */
async function spawnRegionItems(rule, now) {
  try {
    // Count current spawns across ALL regions in this rule
    const regionPatterns = rule.regions.map(r => `region:${r}:%`);
    const placeholders = regionPatterns.map(() => 'spawn_point_id LIKE ?').join(' OR ');
    const [countRows] = await gameDb.query(
      `SELECT COUNT(*) as count FROM spawned_items 
       WHERE (${placeholders}) AND collected_at IS NULL`,
      regionPatterns
    );

    const totalCurrentCount = countRows[0].count;
    if (totalCurrentCount >= rule.maxSpawns) {
      return; // Max spawns reached across all regions
    }

    // Check for items that need respawning across all regions
    const [respawnable] = await gameDb.query(
      `SELECT spawn_id, collected_at FROM spawned_items 
       WHERE (${placeholders}) AND collected_at IS NOT NULL 
       ORDER BY collected_at ASC LIMIT ?`,
      [...regionPatterns, rule.maxSpawns - totalCurrentCount]
    );

    let spawnsNeeded = rule.maxSpawns - totalCurrentCount;

    // Respawn collected items that are off cooldown
    for (const item of respawnable) {
      const timeSinceCollected = now - item.collected_at;
      if (timeSinceCollected >= rule.respawnTime && spawnsNeeded > 0) {
        spawnsNeeded--;

        // Randomly select a region from the list
        const regionId = rule.regions[Math.floor(Math.random() * rule.regions.length)];
        const region = regionsData.find(r => r.id === regionId);
        if (!region) {
          logger.warn(`Region not found: ${regionId}`);
          continue;
        }

        // Generate random point in region
        const polygon = region.coordinates || region.positions || [];
        const point = getRandomPointInPolygon(polygon);
        if (!point) {
          logger.warn(`Could not generate point in region ${regionId}`);
          continue;
        }

        let itemId = null;
        let lootTableKey = null;

        if (rule.type === 'standard') {
          // Pick item from pool
          const totalWeight = rule.itemPool.reduce((sum, item) => sum + item.weight, 0);
          let roll = Math.random() * totalWeight;
          let selectedItem = null;

          for (const item of rule.itemPool) {
            roll -= item.weight;
            if (roll <= 0) {
              selectedItem = item;
              break;
            }
          }

          if (!selectedItem) selectedItem = rule.itemPool[0];

          itemId = await getItemId(selectedItem.item);
          if (!itemId) {
            logger.warn(`Item not found: ${selectedItem.item}`);
            continue;
          }
        } else if (rule.type === 'loot-container') {
          lootTableKey = rule.lootTable;
          if (!LOOT_TABLES[lootTableKey]) {
            logger.warn(`Loot table not found: ${lootTableKey}`);
            continue;
          }
        }

        // Spawn the item
        const spawnPointId = `region:${regionId}:${Date.now()}-${Math.random()}`;
        const [result] = await gameDb.query(
          `INSERT INTO spawned_items (item_id, x, y, realm, type, loot_table_key, spawn_point_id, visual_icon, spawned_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [itemId, point.x, point.y, rule.realm, rule.type, lootTableKey, spawnPointId, rule.visual, now]
        );

        logger.debug(`Spawned region item in ${regionId} at (${point.x}, ${point.y})`);

        // Broadcast to clients
        if (io) {
          io.emit('collectable:spawned', {
            spawnId: result.insertId,
            x: point.x,
            y: point.y,
            realm: rule.realm,
            visualIcon: rule.visual,
            type: rule.type
          });
        }
      }
    }

    // If still need more spawns (initial spawn or not enough respawnable)
    while (spawnsNeeded > 0) {
      // Randomly select a region from the list
      const regionId = rule.regions[Math.floor(Math.random() * rule.regions.length)];
      const region = regionsData.find(r => r.id === regionId);
      if (!region) {
        logger.warn(`Region not found: ${regionId}`);
        break;
      }

      const polygon = region.coordinates || region.positions || [];
      const point = getRandomPointInPolygon(polygon);
      if (!point) {
        logger.warn(`Could not generate point in region ${regionId}`);
        break;
      }

      let itemId = null;
      let lootTableKey = null;

      if (rule.type === 'standard') {
        const totalWeight = rule.itemPool.reduce((sum, item) => sum + item.weight, 0);
        let roll = Math.random() * totalWeight;
        let selectedItem = null;

        for (const item of rule.itemPool) {
          roll -= item.weight;
          if (roll <= 0) {
            selectedItem = item;
            break;
          }
        }

        if (!selectedItem) selectedItem = rule.itemPool[0];

        itemId = await getItemId(selectedItem.item);
        if (!itemId) {
          logger.warn(`Item not found: ${selectedItem.item}`);
          break;
        }
      } else if (rule.type === 'loot-container') {
        lootTableKey = rule.lootTable;
        if (!LOOT_TABLES[lootTableKey]) {
          logger.warn(`Loot table not found: ${lootTableKey}`);
          break;
        }
      }

      const spawnPointId = `region:${regionId}:${Date.now()}-${Math.random()}`;
      const [result] = await gameDb.query(
        `INSERT INTO spawned_items (item_id, x, y, realm, type, loot_table_key, spawn_point_id, visual_icon, spawned_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [itemId, point.x, point.y, rule.realm, rule.type, lootTableKey, spawnPointId, rule.visual, now]
      );

      logger.debug(`Spawned new region item in ${regionId} at (${point.x}, ${point.y})`);

      if (io) {
        io.emit('collectable:spawned', {
          spawnId: result.insertId,
          x: point.x,
          y: point.y,
          realm: rule.realm,
          visualIcon: rule.visual,
          type: rule.type
        });
      }

      spawnsNeeded--;
    }
  } catch (err) {
    logger.error(`Error spawning region items:`, err);
  }
}

/**
 * Process spawn queue - runs every 5 seconds
 */
async function processSpawns() {
  try {
    const now = Math.floor(Date.now() / 1000);

    // Process fixed spawn points
    for (const spawnPoint of FIXED_SPAWN_POINTS) {
      await spawnFixedPoint(spawnPoint, now);
    }

    // Process region-based spawns
    for (const rule of REGION_SPAWN_RULES) {
      await spawnRegionItems(rule, now);
    }
  } catch (err) {
    logger.error('Error processing spawns:', err);
  }
}

/**
 * Initialize spawn queue
 */
function initSpawnQueue(socketIo) {
  io = socketIo;

  spawnQueue = new Bull('spawn-queue', {
    redis: {
      host: process.env.REDIS_HOST || 'redis',
      port: process.env.REDIS_PORT || 6379
    }
  });

  // Define the spawn processor
  spawnQueue.process('process-spawns', async (job) => {
    await processSpawns();
  });

  // Schedule recurring job
  spawnQueue.add(
    'process-spawns',
    {},
    {
      repeat: {
        every: QUEUE_INTERVALS.SPAWN
      },
      ...BULL_JOB_OPTIONS
    }
  );

  logger.info('Spawn queue initialized');

  return spawnQueue;
}

module.exports = { initSpawnQueue, spawnQueue };
