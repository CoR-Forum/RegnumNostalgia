/**
 * Shared geometry utilities.
 * Single source of truth for point-in-polygon and related helpers
 * used across sockets, queues, and services.
 */

/**
 * Point-in-polygon test using ray-casting algorithm.
 * @param {number} px - X coordinate of point
 * @param {number} py - Y coordinate of point
 * @param {Array<[number,number]>} polygon - Array of [x,y] vertices
 * @returns {boolean} True if point is inside the polygon
 */
function pointInPolygon(px, py, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
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
 * Calculate minimum distance from a point to any edge of a polygon.
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {Array<[number,number]>} polygon - Polygon vertices
 * @returns {number} Minimum distance in pixels
 */
function minDistanceToEdge(x, y, polygon) {
  let minDist = Infinity;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const x1 = polygon[j][0], y1 = polygon[j][1];
    const x2 = polygon[i][0], y2 = polygon[i][1];

    const A = x - x1;
    const B = y - y1;
    const C = x2 - x1;
    const D = y2 - y1;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    if (lenSq !== 0) param = dot / lenSq;

    let xx, yy;
    if (param < 0) { xx = x1; yy = y1; }
    else if (param > 1) { xx = x2; yy = y2; }
    else { xx = x1 + param * C; yy = y1 + param * D; }

    const dx = x - xx;
    const dy = y - yy;
    minDist = Math.min(minDist, Math.sqrt(dx * dx + dy * dy));
  }

  return minDist;
}

/**
 * Get a random point inside a polygon using rejection sampling.
 * Ensures the point is at least MIN_DISTANCE_FROM_EDGE pixels from edges.
 * @param {Array<[number,number]>} polygon - Polygon vertices
 * @returns {{ x: number, y: number } | null}
 */
function getRandomPointInPolygon(polygon) {
  if (!polygon || polygon.length === 0) return null;

  const MIN_DISTANCE_FROM_EDGE = 10;

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const [x, y] of polygon) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

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

  // Fallback to centroid
  let cx = 0, cy = 0;
  for (const [x, y] of polygon) { cx += x; cy += y; }
  cx = Math.round(cx / polygon.length);
  cy = Math.round(cy / polygon.length);
  return { x: cx, y: cy };
}

/**
 * Calculate Euclidean distance between two points.
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @returns {number}
 */
function distance(x1, y1, x2, y2) {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy);
}

module.exports = {
  pointInPolygon,
  minDistanceToEdge,
  getRandomPointInPolygon,
  distance
};
