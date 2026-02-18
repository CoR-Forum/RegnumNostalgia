/**
 * Map state accessors.
 *
 * The Leaflet map instance is created asynchronously in the probe.onload handler.
 * Other modules use these getters to access the map, dimensions, and icons
 * without needing direct access to the closed-over variables.
 *
 * The setters are called once by the map initialization code.
 */

let _map = null;
let _totalH = 0;
let _totalW = 0;
let _territoryIcons = {};
let _rasterCoords = null;                 // set when v1 rastercoords is active
const GAME_SIZE = 6144;

export function setMapState(map, totalH, totalW) {
  _map = map;
  _totalH = totalH;
  _totalW = totalW;
  // Expose on window for legacy non-module scripts (build-path.js, regions.js)
  window.map = map;
  window.totalH = totalH;
  window.totalW = totalW;
}

export function setRasterCoords(rc) {
  _rasterCoords = rc;
  window.rasterCoords = rc;
}

export function getRasterCoords() { return _rasterCoords; }

export function setTerritoryIcons(icons) {
  _territoryIcons = icons;
}

/** @returns {L.Map|null} The Leaflet map instance */
export function getMap() { return _map; }

/** @returns {number} The total map height in Leaflet coordinate space */
export function getTotalH() { return _totalH; }

/** @returns {number} The total map width in Leaflet coordinate space */
export function getTotalW() { return _totalW; }

/** @returns {object} Territory icon definitions from markers.json */
export function getTerritoryIcons() { return _territoryIcons; }

/**
 * Convenience: return all map state in one call.
 * @returns {{ map: L.Map|null, totalH: number, totalW: number, territoryIcons: object }}
 */
export function getMapState() {
  return { map: _map, totalH: _totalH, totalW: _totalW, territoryIcons: _territoryIcons };
}

/**
 * Convert game coordinates to a Leaflet LatLng.
 *
 * Game coords: x → east (0-6144), y → south (0 at north, 6144 at south).
 * When rastercoords is active (v1 tiles) this uses L.RasterCoords.unproject.
 * Otherwise falls back to the legacy CRS.Simple mapping [totalH - y, x].
 *
 * @param {number} x - game X coordinate
 * @param {number} y - game Y coordinate
 * @returns {L.LatLng|number[]}
 */
export function gameToLatLng(x, y) {
  if (_rasterCoords) {
    return _rasterCoords.unproject([x, y]);
  }
  return [_totalH - y, x];
}

/**
 * Convert a Leaflet LatLng back to game coordinates.
 *
 * @param {L.LatLng|number[]} latLng
 * @returns {{ x: number, y: number }}
 */
export function latLngToGame(latLng) {
  if (_rasterCoords) {
    const p = _rasterCoords.project(latLng);
    return { x: p.x, y: p.y };
  }
  const lat = typeof latLng.lat === 'number' ? latLng.lat : latLng[0];
  const lng = typeof latLng.lng === 'number' ? latLng.lng : latLng[1];
  return { x: lng, y: _totalH - lat };
}

/**
 * Return the Leaflet LatLng for the centre of the game map.
 */
export function getMapCenter() {
  return gameToLatLng(GAME_SIZE / 2, GAME_SIZE / 2);
}

/**
 * Return a suitable "default" zoom level for initial / reset views.
 * v1 (rastercoords): zoom 3.  v2 (legacy): zoom -2.
 */
export function getDefaultZoom() {
  return _rasterCoords ? 3 : -2;
}

/**
 * Convert an array of [x,y] or {x,y} positions to Leaflet LatLng objects.
 */
export function positionsToLatLngs(positions) {
  if (!positions || !Array.isArray(positions)) return [];
  return positions.map(p => {
    const x = Array.isArray(p) ? p[0] : p.x;
    const y = Array.isArray(p) ? p[1] : p.y;
    return gameToLatLng(x, y);
  });
}

// Expose for legacy non-module scripts (build-path.js)
window.positionsToLatLngs = positionsToLatLngs;
window.gameToLatLng = gameToLatLng;
window.latLngToGame = latLngToGame;
