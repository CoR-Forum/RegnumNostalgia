// Load static game data directly from JSON so this service
// doesn't depend on route modules that may be removed.
// `pathfinding.js` lives in `api/src/services`, so go up two
// levels to reach `api/gameData`.
const pathsData = require('../../gameData/paths.json');
const regionsData = require('../../gameData/regions.json');
const wallsData = require('../../gameData/walls.json');
const { gameDb } = require('../config/database');
const { setActiveWalker, removeActiveWalkerByUser } = require('../config/cache');
const logger = require('../config/logger');
const { pointInPolygon, distance } = require('../utils/geometry');

// Local loaders matching the old `loadPaths()` / `loadRegions()` API
async function loadPaths() { return pathsData; }
async function loadRegions() { return regionsData; }
async function loadWalls() { return wallsData; }

const INF = Number.MAX_SAFE_INTEGER;
const LINK_THRESHOLD = 20; // pixels - cross-path link threshold
const DIRECT_THRESHOLD = 500; // pixels - use direct walking for short trips
const MAX_NODE_DISTANCE = 1000; // pixels - max distance to nearest node
const STEP_SIZE = 20; // pixels per step for interpolation

// distance() and pointInPolygon() imported from ../utils/geometry

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

// pointInPolygon imported from ../utils/geometry

/**
 * Check if a line segment (x1,y1)-(x2,y2) intersects with a line segment (x3,y3)-(x4,y4)
 */
function lineSegmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
  const denominator = ((y4 - y3) * (x2 - x1)) - ((x4 - x3) * (y2 - y1));
  
  // Lines are parallel
  if (Math.abs(denominator) < 0.0001) {
    return false;
  }
  
  const ua = (((x4 - x3) * (y1 - y3)) - ((y4 - y3) * (x1 - x3))) / denominator;
  const ub = (((x2 - x1) * (y1 - y3)) - ((y2 - y1) * (x1 - x3))) / denominator;
  
  // Check if intersection occurs within both line segments
  return (ua >= 0 && ua <= 1) && (ub >= 0 && ub <= 1);
}

/**
 * Check if a path segment crosses any wall and return wall info if it does
 */
async function pathCrossesWall(x1, y1, x2, y2) {
  const walls = await loadWalls();
  
  for (const wall of walls) {
    const positions = wall.positions || [];
    
    // Check if the segment crosses any segment of the wall
    for (let i = 0; i < positions.length - 1; i++) {
      const [wx1, wy1] = positions[i];
      const [wx2, wy2] = positions[i + 1];
      
      if (lineSegmentsIntersect(x1, y1, x2, y2, wx1, wy1, wx2, wy2)) {
        return { crosses: true, wall, intersectionSegment: i };
      }
    }
  }
  
  return { crosses: false };
}

/**
 * Find the best path through a wall
 */
async function findPathThroughWall(wall, fromX, fromY, toX, toY) {
  const paths = await loadPaths();
  const wallPositions = wall.positions || [];
  
  if (wallPositions.length < 2) return null;
  
  let bestPath = null;
  let bestScore = INF;
  let bestReverse = false;
  
  // Find paths that cross through this wall
  for (const path of paths) {
    const positions = path.positions || [];
    if (positions.length < 2) continue;
    
    let crossesWall = false;
    
    // Check if this path crosses the wall
    for (let i = 0; i < positions.length - 1; i++) {
      const [px1, py1] = positions[i];
      const [px2, py2] = positions[i + 1];
      
      for (let j = 0; j < wallPositions.length - 1; j++) {
        const [wx1, wy1] = wallPositions[j];
        const [wx2, wy2] = wallPositions[j + 1];
        
        if (lineSegmentsIntersect(px1, py1, px2, py2, wx1, wy1, wx2, wy2)) {
          crossesWall = true;
          break;
        }
      }
      
      if (crossesWall) break;
    }
    
    // If this path crosses the wall, consider it as a passage
    if (crossesWall) {
      const firstPos = positions[0];
      const lastPos = positions[positions.length - 1];
      
      // Calculate total distance in both directions
      // Forward: from -> first -> last -> to
      const distToFirst = distance(fromX, fromY, firstPos[0], firstPos[1]);
      const distFromLast = distance(lastPos[0], lastPos[1], toX, toY);
      const forwardScore = distToFirst + distFromLast;
      
      // Reverse: from -> last -> first -> to
      const distToLast = distance(fromX, fromY, lastPos[0], lastPos[1]);
      const distFromFirst = distance(firstPos[0], firstPos[1], toX, toY);
      const reverseScore = distToLast + distFromFirst;
      
      // Choose the better direction
      if (forwardScore < bestScore) {
        bestScore = forwardScore;
        bestPath = path;
        bestReverse = false;
      }
      
      if (reverseScore < bestScore) {
        bestScore = reverseScore;
        bestPath = path;
        bestReverse = true;
      }
    }
  }
  
  if (bestPath) {
    return {
      ...bestPath,
      positions: bestReverse ? [...bestPath.positions].reverse() : bestPath.positions,
      reversed: bestReverse
    };
  }
  
  return null;
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
        
        // Check if this edge crosses a wall
        const wallCheck = await pathCrossesWall(
          nodes[prevNodeId].x, nodes[prevNodeId].y,
          nodes[nodeId].x, nodes[nodeId].y
        );
        
        // Only add edge if it doesn't cross a wall
        if (!wallCheck.crosses) {
          adj[prevNodeId][nodeId] = d;
          adj[nodeId][prevNodeId] = d;
        }
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
        // Check if this cross-path link crosses a wall
        const wallCheck = await pathCrossesWall(
          nodes[idA].x, nodes[idA].y,
          nodes[idB].x, nodes[idB].y
        );
        
        if (!wallCheck.crosses) {
          // No wall, add direct link
          adj[idA][idB] = d;
          adj[idB][idA] = d;
        } else {
          // Wall blocks direct path, try to find a passage path
          const passagePath = await findPathThroughWall(
            wallCheck.wall,
            nodes[idA].x, nodes[idA].y,
            nodes[idB].x, nodes[idB].y
          );
          
          if (passagePath && passagePath.positions && passagePath.positions.length > 0) {
            // Calculate distance through the passage path
            let pathDist = distance(nodes[idA].x, nodes[idA].y, passagePath.positions[0][0], passagePath.positions[0][1]);
            
            for (let k = 1; k < passagePath.positions.length; k++) {
              pathDist += distance(
                passagePath.positions[k-1][0], passagePath.positions[k-1][1],
                passagePath.positions[k][0], passagePath.positions[k][1]
              );
            }
            
            const lastPos = passagePath.positions[passagePath.positions.length - 1];
            pathDist += distance(lastPos[0], lastPos[1], nodes[idB].x, nodes[idB].y);
            
            // Add the connection with the passage path distance
            adj[idA][idB] = pathDist;
            adj[idB][idA] = pathDist;
          }
          // If no passage path, nodes remain disconnected
        }
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
  
  // Track if we need to prepend a passage path crossing
  let passagePrefixPositions = null;
  let searchStartX = playerX;
  let searchStartY = playerY;

  // For short trips, check if direct walking crosses a wall
  if (tripDist <= DIRECT_THRESHOLD) {
    const wallCheck = await pathCrossesWall(playerX, playerY, targetX, targetY);
    
    if (!wallCheck.crosses) {
      // Direct path is clear, use it
      const positions = [[playerX, playerY]];
      positions.push(...interpolateSteps(playerX, playerY, targetX, targetY));
      return positions;
    } else {
      // Direct path crosses a wall, try to use a passage path through it
      const passagePath = await findPathThroughWall(wallCheck.wall, playerX, playerY, targetX, targetY);
      
      if (passagePath && passagePath.positions) {
        // Determine which end of the passage path is closer to player
        const firstPos = passagePath.positions[0];
        const lastPos = passagePath.positions[passagePath.positions.length - 1];
        const distToFirst = distance(playerX, playerY, firstPos[0], firstPos[1]);
        const distToLast = distance(playerX, playerY, lastPos[0], lastPos[1]);
        
        // Use the closest end as entrance, and reverse path if needed
        let orderedPositions = passagePath.positions;
        if (distToLast < distToFirst) {
          orderedPositions = [...passagePath.positions].reverse();
        }
        
        // Build the passage crossing prefix
        passagePrefixPositions = [[playerX, playerY]];
        
        // Walk to the nearest entrance of the passage path
        const pathEntrance = orderedPositions[0];
        passagePrefixPositions.push(...interpolateSteps(playerX, playerY, pathEntrance[0], pathEntrance[1]));
        
        // Check each point along the passage path to see if we can exit early
        let canExitToTarget = false;
        let exitIndex = -1;
        
        // First, check if we can walk directly to target from any passage point
        for (let i = 0; i < orderedPositions.length; i++) {
          const pos = orderedPositions[i];
          const distToTarget = distance(pos[0], pos[1], targetX, targetY);
          
          if (distToTarget <= DIRECT_THRESHOLD) {
            const wallCheck = await pathCrossesWall(pos[0], pos[1], targetX, targetY);
            if (!wallCheck.crosses) {
              // Found an exit point - can walk directly to target from here
              canExitToTarget = true;
              exitIndex = i;
              break;
            }
          }
        }
        
        if (canExitToTarget) {
          // Add positions up to the exit point
          for (let i = 0; i <= exitIndex; i++) {
            passagePrefixPositions.push(orderedPositions[i]);
          }
          // Walk directly to target from exit point
          const exitPos = orderedPositions[exitIndex];
          passagePrefixPositions.push(...interpolateSteps(exitPos[0], exitPos[1], targetX, targetY));
          return passagePrefixPositions;
        }
        
        // If can't reach target directly, add all passage positions
        orderedPositions.forEach(pos => {
          passagePrefixPositions.push(pos);
        });
        
        // Use path network from passage exit to target
        const pathExit = orderedPositions[orderedPositions.length - 1];
        searchStartX = pathExit[0];
        searchStartY = pathExit[1];
      }
      // If no passage path found, fall through to path network navigation
    }
  }

  // For longer trips or after wall crossing, use path network
  const { nodes, adj } = await buildPathGraph();
  
  if (Object.keys(nodes).length === 0) {
    throw new Error('No path nodes available');
  }

  // If we have a passage prefix, check if we can exit earlier to join the path network
  if (passagePrefixPositions) {
    const passages = passagePrefixPositions.slice(); // Clone the array
    
    // Check each point along the passage path (after the interpolated walk to the passage start)
    let bestExitIndex = -1;
    let bestExitNode = null;
    let bestExitDist = INF;
    
    // Find how many positions are just the walk to the passage start
    let passageStartIndex = 0;
    for (let i = 0; i < passages.length; i++) {
      // Look for the actual passage path positions (not interpolated steps)
      // These would be the positions from passagePath.positions
      // For simplicity, we'll check all positions after the initial player position
      if (i === 0) continue; // Skip player starting position
      
      const pos = passages[i];
      
      // Check if we can reach any path node from this position
      for (const nodeId in nodes) {
        const node = nodes[nodeId];
        const distToNode = distance(pos[0], pos[1], node.x, node.y);
        
        if (distToNode <= MAX_NODE_DISTANCE) {
          const wallCheck = await pathCrossesWall(pos[0], pos[1], node.x, node.y);
          if (!wallCheck.crosses && distToNode < bestExitDist) {
            bestExitDist = distToNode;
            bestExitIndex = i;
            bestExitNode = nodeId;
          }
        }
      }
      
      // If we found a good exit point, use it
      if (bestExitNode !== null) {
        // Trim the passage prefix to this exit point
        passagePrefixPositions = passages.slice(0, bestExitIndex + 1);
        searchStartX = passages[bestExitIndex][0];
        searchStartY = passages[bestExitIndex][1];
        break;
      }
    }
  }

  // Find nearest nodes to searchStart (either player position, passage point, or passage exit) and target
  let startNode = null;
  let endNode = null;
  let minStartDist = INF;
  let minEndDist = INF;

  // Find the best start node (closest to searchStart that doesn't cross a wall)
  for (const nodeId in nodes) {
    const node = nodes[nodeId];
    const distToStart = distance(searchStartX, searchStartY, node.x, node.y);
    
    if (distToStart < minStartDist && distToStart <= MAX_NODE_DISTANCE) {
      const wallCheck = await pathCrossesWall(searchStartX, searchStartY, node.x, node.y);
      if (!wallCheck.crosses) {
        minStartDist = distToStart;
        startNode = nodeId;
      }
    }
  }

  // Find the best end node (closest to target that doesn't cross a wall)
  for (const nodeId in nodes) {
    const node = nodes[nodeId];
    const distToEnd = distance(targetX, targetY, node.x, node.y);
    
    if (distToEnd < minEndDist && distToEnd <= MAX_NODE_DISTANCE) {
      const wallCheck = await pathCrossesWall(node.x, node.y, targetX, targetY);
      if (!wallCheck.crosses) {
        minEndDist = distToEnd;
        endNode = nodeId;
      }
    }
  }

  // If no suitable start or end nodes found, throw error
  if (startNode === null) {
    throw new Error('Cannot reach path network - all nearby paths are blocked by walls');
  }
  
  if (endNode === null) {
    throw new Error('Cannot reach destination - all nearby paths are blocked by walls');
  }

  const positions = [];

  // Use Dijkstra to find path through network
  const pathNodeIds = dijkstra(adj, startNode, endNode);

  if (pathNodeIds === null) {
    throw new Error('No path found through the network');
  }

  // Add path nodes
  pathNodeIds.forEach(nodeId => {
    positions.push([nodes[nodeId].x, nodes[nodeId].y]);
  });

  // Prepend passage prefix if we crossed a wall, otherwise interpolate from player
  if (passagePrefixPositions) {
    // Check if first node is very close to passage exit (within STEP_SIZE)
    const first = positions[0];
    const distToFirstNode = distance(searchStartX, searchStartY, first[0], first[1]);
    
    if (distToFirstNode > STEP_SIZE) {
      // Need to bridge from passage exit to first path node
      const bridgeSteps = interpolateSteps(searchStartX, searchStartY, first[0], first[1]);
      bridgeSteps.pop(); // Remove duplicate of first position
      passagePrefixPositions.push(...bridgeSteps);
    }
    // Remove first position from main path to avoid duplication
    positions.shift();
    // Prepend the entire passage prefix
    positions.unshift(...passagePrefixPositions);
  } else {
    // Prepend interpolated steps from player to first node
    const first = positions[0];
    if (first[0] !== searchStartX || first[1] !== searchStartY) {
      const prefix = [[searchStartX, searchStartY]];
      prefix.push(...interpolateSteps(searchStartX, searchStartY, first[0], first[1]));
      prefix.pop(); // Remove duplicate of first position
      positions.unshift(...prefix);
    }
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
async function createWalker(userId, positions, collecting = null) {
  const now = Math.floor(Date.now() / 1000);

  // Remove any active walker from Redis cache
  await removeActiveWalkerByUser(userId);

  // Mark any active walks as interrupted
  await gameDb.query(
    `UPDATE walkers SET status = 'interrupted_by_new_walk', updated_at = ? 
     WHERE user_id = ? AND status IN ('new', 'walking')`,
    [now, userId]
  );

  // Insert new walker
  const [result] = await gameDb.query(
    `INSERT INTO walkers (user_id, positions, current_index, started_at, updated_at, status, finished_at, collecting_x, collecting_y, collecting_spawn_id)
     VALUES (?, ?, 0, ?, ?, 'walking', NULL, ?, ?, ?)`,
    [
      userId, 
      JSON.stringify(positions), 
      now, 
      now, 
      collecting ? collecting.collectingX : null, 
      collecting ? collecting.collectingY : null,
      collecting ? collecting.collectingSpawnId : null
    ]
  );

  // Store walker state in Redis for fast tick processing
  await setActiveWalker(result.insertId, {
    user_id: userId,
    positions: positions,
    current_index: 0,
    status: 'walking',
    collecting_x: collecting ? collecting.collectingX : null,
    collecting_y: collecting ? collecting.collectingY : null,
    collecting_spawn_id: collecting ? collecting.collectingSpawnId : null
  });

  logger.info('Walker created', { 
    walkerId: result.insertId, 
    userId, 
    steps: positions.length,
    collecting: collecting ? true : false
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
  pointInPolygon,
  pathCrossesWall
};
