// Load static game data directly from JSON so this service
// doesn't depend on route modules that may be removed.
// `pathfinding.js` lives in `api/src/services`, so go up two
// levels to reach `api/gameData`.
const pathsData = require('../../gameData/paths.json');
const regionsData = require('../../gameData/regions.json');
const { gameDb } = require('../config/database');
const logger = require('../config/logger');

// Local loaders matching the old `loadPaths()` / `loadRegions()` API
async function loadPaths() { return pathsData; }
async function loadRegions() { return regionsData; }

const INF = Number.MAX_SAFE_INTEGER;
const LINK_THRESHOLD = 40; // pixels - cross-path link threshold
const DIRECT_THRESHOLD = 300; // pixels - use direct walking for short trips
const MAX_NODE_DISTANCE = 300; // pixels - max distance to nearest node
const STEP_SIZE = 40; // pixels per step for interpolation

/**
 * Calculate Euclidean distance between two points
 */
function distance(x1, y1, x2, y2) {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Dijkstra's algorithm for pathfinding
 */
function dijkstra(adj, start, goal) {
  const dist = {};
  const prev = {};
  const Q = {};

  // Initialize
  for (const v in adj) {
    dist[v] = INF;
    prev[v] = null;
    Q[v] = true;
  }
  dist[start] = 0;

  // Main loop
  while (Object.keys(Q).length > 0) {
    // Find node with minimum distance
    let u = null;
    let best = INF;
    for (const v in Q) {
      if (dist[v] < best) {
        best = dist[v];
        u = v;
      }
    }

    if (u === null || u == goal) break;
    delete Q[u];

    // Update neighbors
    if (adj[u]) {
      for (const v in adj[u]) {
        if (dist[v] === undefined) continue;
        const alt = dist[u] + adj[u][v];
        if (alt < dist[v]) {
          dist[v] = alt;
          prev[v] = u;
        }
      }
    }
  }

  // Reconstruct path
  if (dist[goal] === INF) return null;
  
  const path = [];
  let u = goal;
  while (u !== null) {
    path.unshift(parseInt(u));
    u = prev[u];
  }
  
  return path;
}

/**
 * Point-in-polygon test using ray casting algorithm
 */
function pointInPolygon(x, y, polygon) {
  let inside = false;
  const n = polygon.length;
  if (n < 3) return false;

  let j = n - 1;
  for (let i = 0; i < n; j = i++) {
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
 * Validate if a point is in a walkable region for the player's realm
 */
async function validateWalkableRegion(x, y, realm) {
  const regions = await loadRegions();
  
  let matched = false;
  for (const region of regions) {
    const poly = region.coordinates || region.positions || region.points || [];
    if (poly.length === 0) continue;

    if (pointInPolygon(x, y, poly)) {
      matched = true;
      const rtype = region.type || null;
      const rowner = region.owner || region.ownerRealm || null;
      const rwalkable = region.walkable !== undefined ? region.walkable : 
                        (region.properties?.walkable !== undefined ? region.properties.walkable : true);
      const ownerMatches = (rowner === null) ? true : (rowner === realm);

      // Warzones are always walkable
      if (rtype === 'warzone') {
        return { valid: true, region: region.name };
      }

      // Check if walkable and owner matches
      if (!(rwalkable && ownerMatches)) {
        return { valid: false, error: 'Cannot walk to that region', region: region.name };
      }
      
      return { valid: true, region: region.name };
    }
  }

  // If no region matched, it's water
  if (regions.length > 0 && !matched) {
    return { valid: false, error: 'You cannot swim' };
  }

  // No regions defined, allow movement
  return { valid: true };
}

/**
 * Interpolate steps between two points
 */
function interpolateSteps(x1, y1, x2, y2, stepSize = STEP_SIZE) {
  const steps = [];
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = distance(x1, y1, x2, y2);

  if (dist <= stepSize || dist === 0) {
    steps.push([x2, y2]);
  } else {
    const numSteps = Math.ceil(dist / stepSize);
    for (let i = 1; i <= numSteps; i++) {
      const t = i / numSteps;
      const px = Math.round(x1 + dx * t);
      const py = Math.round(y1 + dy * t);
      steps.push([px, py]);
    }
  }

  return steps;
}

/**
 * Build path graph from paths.json
 */
async function buildPathGraph() {
  const paths = await loadPaths();
  
  const nodes = {};
  const nodeIndex = {};
  let nextId = 0;

  // Build nodes from all path points
  paths.forEach((path, pathIdx) => {
    const positions = path.positions || [];
    positions.forEach((pos, pointIdx) => {
      const [x, y] = pos;
      nodes[nextId] = {
        x,
        y,
        path: path.id || path.name || pathIdx,
        pathIndex: pathIdx,
        pointIndex: pointIdx
      };
      
      if (!nodeIndex[pathIdx]) nodeIndex[pathIdx] = {};
      nodeIndex[pathIdx][pointIdx] = nextId;
      nextId++;
    });
  });

  // Build adjacency list
  const adj = {};
  for (const id in nodes) {
    adj[id] = {};
  }

  // Add edges between consecutive points on same path
  for (const pathIdx in nodeIndex) {
    const points = nodeIndex[pathIdx];
    let prevNodeId = null;
    
    for (const pointIdx in points) {
      const nodeId = points[pointIdx];
      if (prevNodeId !== null) {
        const d = distance(
          nodes[prevNodeId].x, nodes[prevNodeId].y,
          nodes[nodeId].x, nodes[nodeId].y
        );
        adj[prevNodeId][nodeId] = d;
        adj[nodeId][prevNodeId] = d;
      }
      prevNodeId = nodeId;
    }
  }

  // Add cross-path links within threshold
  const nodeIds = Object.keys(nodes).map(id => parseInt(id));
  for (let i = 0; i < nodeIds.length; i++) {
    for (let j = i + 1; j < nodeIds.length; j++) {
      const idA = nodeIds[i];
      const idB = nodeIds[j];
      const d = distance(nodes[idA].x, nodes[idA].y, nodes[idB].x, nodes[idB].y);
      
      if (d <= LINK_THRESHOLD) {
        adj[idA][idB] = d;
        adj[idB][idA] = d;
      }
    }
  }

  return { nodes, adj };
}

/**
 * Find path from player position to target position
 */
async function findPath(userId, targetX, targetY, realm) {
  // Validate target is walkable
  const validation = await validateWalkableRegion(targetX, targetY, realm);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Get player position
  const [rows] = await gameDb.query(
    'SELECT x, y FROM players WHERE user_id = ?',
    [userId]
  );

  if (rows.length === 0) {
    throw new Error('Player not found');
  }

  const playerX = rows[0].x;
  const playerY = rows[0].y;

  const tripDist = distance(playerX, playerY, targetX, targetY);

  // For short trips, use direct walking
  if (tripDist <= DIRECT_THRESHOLD) {
    const positions = [[playerX, playerY]];
    positions.push(...interpolateSteps(playerX, playerY, targetX, targetY));
    return positions;
  }

  // For longer trips, use path network
  const { nodes, adj } = await buildPathGraph();
  
  if (Object.keys(nodes).length === 0) {
    throw new Error('No path nodes available');
  }

  // Find nearest nodes to player and target
  let startNode = null;
  let endNode = null;
  let minStartDist = INF;
  let minEndDist = INF;

  for (const nodeId in nodes) {
    const node = nodes[nodeId];
    const distToStart = distance(playerX, playerY, node.x, node.y);
    const distToEnd = distance(targetX, targetY, node.x, node.y);

    if (distToStart < minStartDist) {
      minStartDist = distToStart;
      startNode = nodeId;
    }

    if (distToEnd < minEndDist) {
      minEndDist = distToEnd;
      endNode = nodeId;
    }
  }

  const positions = [];

  // If player is too far from any node, start directly from player position
  if (minStartDist > MAX_NODE_DISTANCE) {
    positions.push([playerX, playerY]);
  } else {
    // Use Dijkstra to find path through network
    const pathNodeIds = endNode !== null ? dijkstra(adj, startNode, endNode) : null;

    if (pathNodeIds === null) {
      // No path found, just start from nearest node
      positions.push([nodes[startNode].x, nodes[startNode].y]);
    } else {
      // Add path nodes
      pathNodeIds.forEach(nodeId => {
        positions.push([nodes[nodeId].x, nodes[nodeId].y]);
      });
    }
  }

  // Prepend interpolated steps from player to first node if needed
  const first = positions[0];
  if (first[0] !== playerX || first[1] !== playerY) {
    const prefix = [[playerX, playerY]];
    prefix.push(...interpolateSteps(playerX, playerY, first[0], first[1]));
    prefix.pop(); // Remove duplicate of first position
    positions.unshift(...prefix);
  }

  // Append interpolated steps from last node to target
  const last = positions[positions.length - 1];
  if (last[0] !== targetX || last[1] !== targetY) {
    positions.push(...interpolateSteps(last[0], last[1], targetX, targetY));
  }

  return positions;
}

/**
 * Create a walker job for player movement
 */
async function createWalker(userId, positions) {
  const now = Math.floor(Date.now() / 1000);

  // Mark any active walks as interrupted
  await gameDb.query(
    `UPDATE walkers SET status = 'interrupted_by_new_walk', updated_at = ? 
     WHERE user_id = ? AND status IN ('new', 'walking')`,
    [now, userId]
  );

  // Insert new walker
  const [result] = await gameDb.query(
    `INSERT INTO walkers (user_id, positions, current_index, started_at, updated_at, status, finished_at)
     VALUES (?, ?, 0, ?, ?, 'walking', NULL)`,
    [userId, JSON.stringify(positions), now, now]
  );

  logger.info('Walker created', { 
    walkerId: result.insertId, 
    userId, 
    steps: positions.length 
  });

  return {
    walkerId: result.insertId,
    currentIndex: 0,
    destination: positions[positions.length - 1],
    steps: positions.length,
    positions
  };
}

module.exports = {
  findPath,
  createWalker,
  validateWalkableRegion,
  distance,
  pointInPolygon
};
