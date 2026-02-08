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

export function setMapState(map, totalH, totalW) {
  _map = map;
  _totalH = totalH;
  _totalW = totalW;
  // Expose on window for legacy non-module scripts (build-path.js, regions.js)
  window.map = map;
  window.totalH = totalH;
  window.totalW = totalW;
}

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
 * Convert an array of [x,y] or {x,y} positions to Leaflet LatLng objects.
 */
export function positionsToLatLngs(positions) {
  if (!positions || !Array.isArray(positions)) return [];
  return positions.map(p => {
    const x = Array.isArray(p) ? p[0] : p.x;
    const y = Array.isArray(p) ? p[1] : p.y;
    return [_totalH - y, x];
  });
}

// Expose for legacy non-module scripts (build-path.js)
window.positionsToLatLngs = positionsToLatLngs;
