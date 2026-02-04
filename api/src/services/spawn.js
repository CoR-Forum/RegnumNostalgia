const fs = require('fs');
const path = require('path');
const { gameDb } = require('../config/database');
const logger = require('../config/logger');

let spawnLocations = [];
let regions = [];

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

  const MAX_ACTIVE_SPAWNS_PER_REALM = 50; // Limit to prevent excessive spawning

  for (const location of spawnLocations) {
    const currentActive = activeByRealm[location.realm] || 0;
    if (currentActive >= MAX_ACTIVE_SPAWNS_PER_REALM) {
      logger.info(`Skipping spawn for ${location.realm} - too many active items (${currentActive})`);
      continue;
    }

    // Count active items in this location's regions
    let regionActiveCount = 0;
    if (location.spawn_regions) {
      for (const regionId of location.spawn_regions) {
        const region = regions.find(r => r.id === regionId);
        if (!region || !region.coordinates) continue;

        // Get all active spawned items in this realm
        const [activeItems] = await gameDb.query(
          'SELECT x, y FROM spawned_items WHERE realm = ? AND collected_at IS NULL',
          [location.realm]
        );

        // Count how many are inside this region
        for (const item of activeItems) {
          if (pointInPolygon(item.x, item.y, region.coordinates)) {
            regionActiveCount++;
          }
        }
      }
    }

    const maxAllowed = location.max_spawns_per_region * (location.spawn_regions?.length || 1);
    if (regionActiveCount >= maxAllowed) {
      logger.info(`Skipping spawn for location ${location.region_id} - region already has ${regionActiveCount}/${maxAllowed} active items`);
      continue;
    }

    // Handle fixed spawn points
    if (location.spawn_points) {
      for (const spawnPoint of location.spawn_points) {
        await trySpawnAtLocation(location, spawnPoint.x, spawnPoint.y, now, spawnedItems);
      }
    }

    // Handle region-based random spawning
    if (location.spawn_regions && location.max_spawns_per_region) {
      for (const regionId of location.spawn_regions) {
        const region = regions.find(r => r.id === regionId);
        if (!region || !region.coordinates) continue;

        // Try to spawn up to max_spawns_per_region times
        for (let i = 0; i < location.max_spawns_per_region; i++) {
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
    'SELECT si.spawned_item_id, si.item_id, i.template_key, i.name, i.stackable FROM spawned_items si JOIN items i ON si.item_id = i.item_id WHERE si.x = ? AND si.y = ? AND si.collected_at IS NULL',
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

  // Add to inventory - stack if item is stackable
  if (spawnedItem.stackable) {
    await gameDb.query(
      'INSERT INTO inventory (user_id, item_id, quantity, acquired_at) VALUES (?, ?, 1, ?) ON DUPLICATE KEY UPDATE quantity = quantity + 1',
      [userId, spawnedItem.item_id, now]
    );
  } else {
    await gameDb.query(
      'INSERT INTO inventory (user_id, item_id, quantity, acquired_at) VALUES (?, ?, 1, ?)',
      [userId, spawnedItem.item_id, now]
    );
  }

  logger.info('Item collected', {
    userId,
    item: spawnedItem.template_key,
    location: { x, y }
  });

  return { item: spawnedItem.name, template_key: spawnedItem.template_key };
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
  loadSpawnLocations
};