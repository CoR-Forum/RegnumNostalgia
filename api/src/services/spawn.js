const fs = require('fs');
const path = require('path');
const { gameDb } = require('../config/database');
const logger = require('../config/logger');

let spawnLocations = [];
let regions = [];
let io = null;

function setSocketIO(socketIO) {
  io = socketIO;
}

// Load spawn locations and regions
function loadSpawnLocations() {
  try {
    const filePath = path.resolve(__dirname, '../../gameData/spawn-locations.json');
    spawnLocations = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    logger.info(`Loaded ${spawnLocations.length} spawn locations`);
  } catch (error) {
    logger.error('Failed to load spawn locations', { error: error.message });
  }
}

function loadRegions() {
  try {
    const filePath = path.resolve(__dirname, '../../gameData/regions.json');
    regions = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    logger.info(`Loaded ${regions.length} regions for spawning`);
  } catch (error) {
    logger.error('Failed to load regions', { error: error.message });
  }
}

// Point in polygon test (ray casting algorithm)
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

// Generate random point within a polygon
function generateRandomPointInPolygon(polygon) {
  if (!polygon || polygon.length < 3) return null;

  // Get bounding box
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of polygon) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  // Try up to 100 times to find a point inside the polygon
  for (let attempts = 0; attempts < 100; attempts++) {
    const x = Math.random() * (maxX - minX) + minX;
    const y = Math.random() * (maxY - minY) + minY;

    if (pointInPolygon(x, y, polygon)) {
      return { x: Math.round(x), y: Math.round(y) };
    }
  }

  // Fallback: return center of bounding box
  return {
    x: Math.round((minX + maxX) / 2),
    y: Math.round((minY + maxY) / 2)
  };
}

async function spawnItems() {
  const now = Math.floor(Date.now() / 1000);
  const spawnedItems = [];

  // Check current active spawned items per realm to prevent over-spawning
  const [activeCounts] = await gameDb.query(
    'SELECT realm, COUNT(*) as count FROM spawned_items WHERE collected_at IS NULL GROUP BY realm'
  );
  const activeByRealm = {};
  activeCounts.forEach(row => {
    activeByRealm[row.realm] = row.count;
  });

  // Get all active items grouped by realm for region counting
  const [allActiveItems] = await gameDb.query(
    'SELECT realm, x, y FROM spawned_items WHERE collected_at IS NULL'
  );
  const activeItemsByRealm = {};
  allActiveItems.forEach(item => {
    if (!activeItemsByRealm[item.realm]) activeItemsByRealm[item.realm] = [];
    activeItemsByRealm[item.realm].push(item);
  });

  const MAX_ACTIVE_SPAWNS_PER_REALM = 50; // Limit to prevent excessive spawning

  for (const location of spawnLocations) {
    const currentActive = activeByRealm[location.realm] || 0;
    if (currentActive >= MAX_ACTIVE_SPAWNS_PER_REALM) {
      logger.info(`Skipping spawn for ${location.realm} - too many active items (${currentActive})`);
      continue;
    }

    // Count active items per region for this location
    const realmItems = activeItemsByRealm[location.realm] || [];
    const regionCounts = {};
    if (location.spawn_regions) {
      for (const regionId of location.spawn_regions) {
        const region = regions.find(r => r.id === regionId);
        if (!region || !region.coordinates) continue;

        let countInRegion = 0;
        for (const item of realmItems) {
          if (pointInPolygon(item.x, item.y, region.coordinates)) {
            countInRegion++;
          }
        }
        regionCounts[regionId] = countInRegion;
      }
    }

    // Handle region-based random spawning
    if (location.spawn_regions && location.max_spawns_per_region) {
      for (const regionId of location.spawn_regions) {
        const region = regions.find(r => r.id === regionId);
        if (!region || !region.coordinates) continue;

        const currentCount = regionCounts[regionId] || 0;
        if (currentCount >= location.max_spawns_per_region) {
          logger.info(`Skipping spawn for location ${location.region_id} region ${regionId} - already has ${currentCount}/${location.max_spawns_per_region} active items`);
          continue;
        }

        // Try to spawn up to max_spawns_per_region times, but respect the current count
        const attempts = Math.min(location.max_spawns_per_region - currentCount, location.max_spawns_per_region);
        for (let i = 0; i < attempts; i++) {
          const randomPoint = generateRandomPointInPolygon(region.coordinates);
          if (randomPoint) {
            await trySpawnAtLocation(location, randomPoint.x, randomPoint.y, now, spawnedItems);
          }
        }
      }
    }
  }

  return spawnedItems;
}

async function trySpawnAtLocation(location, x, y, now, spawnedItems) {
  // Check if item already spawned at this location
  const [existing] = await gameDb.query(
    'SELECT spawned_item_id FROM spawned_items WHERE x = ? AND y = ? AND (collected_at IS NULL OR respawn_time > ?)',
    [x, y, now]
  );

  if (existing.length > 0) return; // Already spawned and not ready to respawn

  // Select item to spawn based on chance
  const item = selectItem(location.items);
  if (!item) return;

  // Get item_id
  const [itemRows] = await gameDb.query('SELECT item_id, icon_name, name FROM items WHERE template_key = ?', [item.template_key]);
  if (itemRows.length === 0) return;

  const itemId = itemRows[0].item_id;
  const iconName = itemRows[0].icon_name;
  const itemName = itemRows[0].name;
  const quantity = Math.floor(Math.random() * (item.max_quantity - item.min_quantity + 1)) + item.min_quantity;

  // Spawn the item
  await gameDb.query(
    'INSERT INTO spawned_items (item_id, x, y, realm, spawned_at, respawn_time) VALUES (?, ?, ?, ?, ?, ?)',
    [itemId, x, y, location.realm, now, now + location.respawn_interval]
  );

  // Collect spawned item info for return
  spawnedItems.push({
    x: x,
    y: y,
    realm: location.realm,
    template_key: item.template_key,
    icon_name: iconName,
    name: itemName
  });

  logger.info('Spawned item', {
    item: item.template_key,
    quantity,
    location: { x, y },
    realm: location.realm
  });
}

function selectItem(items) {
  const rand = Math.random();
  let cumulative = 0;
  for (const item of items) {
    cumulative += item.chance;
    if (rand <= cumulative) {
      return item;
    }
  }
  return null;
}

async function collectItem(userId, x, y) {
  const [rows] = await gameDb.query(
    'SELECT si.spawned_item_id, si.item_id, si.realm, i.template_key, i.name, i.stackable, i.drops FROM spawned_items si JOIN items i ON si.item_id = i.item_id WHERE si.x = ? AND si.y = ? AND si.collected_at IS NULL',
    [x, y]
  );

  if (rows.length === 0) {
    throw new Error('No collectable item at this location');
  }

  const spawnedItem = rows[0];
  const now = Math.floor(Date.now() / 1000);

  // Mark as collected
  await gameDb.query(
    'UPDATE spawned_items SET collected_by = ?, collected_at = ? WHERE spawned_item_id = ?',
    [userId, now, spawnedItem.spawned_item_id]
  );

  let collectedItem = spawnedItem;
  let collectedQuantity = 1;

  // Check if item has drops (node behavior)
  if (spawnedItem.drops) {
    const drops = JSON.parse(spawnedItem.drops);
    const drop = selectItem(drops);
    if (drop) {
      // Get the drop item details
      const [dropRows] = await gameDb.query('SELECT item_id, name, template_key FROM items WHERE template_key = ?', [drop.template_key]);
      if (dropRows.length > 0) {
        collectedItem = {
          item_id: dropRows[0].item_id,
          name: dropRows[0].name,
          template_key: dropRows[0].template_key
        };
        collectedQuantity = Math.floor(Math.random() * (drop.max_quantity - drop.min_quantity + 1)) + drop.min_quantity;
      }
    }
  }

  // Add to inventory - stack if item is stackable
  if (collectedItem.stackable) {
    await gameDb.query(
      'INSERT INTO inventory (user_id, item_id, quantity, acquired_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE quantity = quantity + ?',
      [userId, collectedItem.item_id, collectedQuantity, now, collectedQuantity]
    );
  } else {
    // For non-stackable, add multiple entries if quantity > 1
    for (let i = 0; i < collectedQuantity; i++) {
      await gameDb.query(
        'INSERT INTO inventory (user_id, item_id, quantity, acquired_at) VALUES (?, ?, 1, ?)',
        [userId, collectedItem.item_id, now]
      );
    }
  }

  // Notify all clients in the realm that the item was collected
  if (io) {
    io.emit('spawned-items:collected', { x, y, realm: spawnedItem.realm });
  }

  logger.info('Item collected', {
    userId,
    item: collectedItem.template_key,
    quantity: collectedQuantity,
    location: { x, y }
  });

  return { item: collectedItem.name, template_key: collectedItem.template_key, quantity: collectedQuantity };
}

async function getSpawnedItems(realm) {
  const [rows] = await gameDb.query(
    'SELECT si.x, si.y, i.template_key, i.icon_name FROM spawned_items si JOIN items i ON si.item_id = i.item_id WHERE si.realm = ? AND si.collected_at IS NULL',
    [realm]
  );
  return rows;
}

loadSpawnLocations();
loadRegions();

module.exports = {
  spawnItems,
  collectItem,
  getSpawnedItems,
  loadSpawnLocations,
  setSocketIO
};