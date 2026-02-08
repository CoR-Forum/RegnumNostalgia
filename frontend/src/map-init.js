/**
 * Map Initialization — tile probing, Leaflet map creation, tile overlays,
 * markers.json loading, coordinate readout, pending-collectables flush.
 */

import { gameState } from './state.js';
import { setMapState, setTerritoryIcons, positionsToLatLngs } from './map-state.js';

const rows = 3;
const cols = 3;

let currentTileVersion = localStorage.getItem('tileVersion') || 'v1';
const tileUrl = (r, c) => `https://cor-forum.de/regnum/RegnumNostalgia/map/tiles-${currentTileVersion}/${r}-${c}.png`;

/**
 * Start map initialization by probing the first tile and setting up the Leaflet map.
 * Returns a Promise that resolves when tile load and map are ready.
 */
export function initMap() {
  return new Promise((resolve, reject) => {
    const probe = new Image();
    probe.src = tileUrl(1, 1);

    probe.onload = () => {
      const tileW = probe.width;
      const tileH = probe.height;
      const origTotalW = cols * tileW;
      const origTotalH = rows * tileH;
      const baseScale = 6144 / origTotalW;

      let scaleX = baseScale;
      let scaleY = baseScale;
      if (currentTileVersion === 'v2') {
        scaleX = baseScale * 1.00;
        scaleY = baseScale * 1.01;
      }

      const totalW = origTotalW * scaleX;
      const totalH = origTotalH * scaleY;

      const map = L.map('map', {
        crs: L.CRS.Simple,
        minZoom: -3,
        maxZoom: 2,
        maxBoundsViscosity: 0.5,
        zoomControl: false,
        scrollWheelZoom: true,
        doubleClickZoom: false,
        boxZoom: false,
        touchZoom: true,
        keyboard: false,
      });

      const fullBounds = [[0, 0], [totalH, totalW]];
      map.fitBounds(fullBounds);

      const pad = 1000 * Math.max(scaleX, scaleY);
      const paddedBounds = [[-pad, -pad], [totalH + pad, totalW + pad]];
      map.setMaxBounds(paddedBounds);

      // Store map globals via accessor module
      setMapState(map, totalH, totalW);

      // Helper: add raster-coord marker
      function addRasterMarker(x, y, opts) {
        return L.marker([totalH - y, x], opts).addTo(map);
      }

      // Region display init (from regions.js)
      try {
        if (typeof window.initRegionDisplay === 'function') {
          window.initRegionDisplay(map, gameState, window.apiCall, positionsToLatLngs);
        }
      } catch (e) { console.debug('initRegionDisplay failed', e); }

      // Load tiles
      let tileOverlays = [];
      let tileLayer = null;

      function loadTiles() {
        tileOverlays.forEach((overlay) => map.removeLayer(overlay));
        tileOverlays = [];
        if (tileLayer) { map.removeLayer(tileLayer); tileLayer = null; }

        for (let r = 1; r <= rows; r++) {
          for (let c = 1; c <= cols; c++) {
            const rowPos = rows - r;
            const y1 = rowPos * tileH * scaleY;
            const x1 = (c - 1) * tileW * scaleX;
            const y2 = (rowPos + 1) * tileH * scaleY;
            const x2 = c * tileW * scaleX;
            const overlay = L.imageOverlay(tileUrl(r, c), [[y1, x1], [y2, x2]]).addTo(map);
            tileOverlays.push(overlay);
          }
        }
      }
      loadTiles();

      L.control.scale({ metric: false, imperial: false }).addTo(map);

      // Load markers.json
      fetch('assets/markers.json').then((r) => r.json()).then((data) => {
        const icons = {};
        for (const [key, def] of Object.entries(data.icons || {})) {
          const size = def.size || [24, 24];
          const anchor = def.anchor || [Math.floor(size[0] / 2), size[1]];
          icons[key] = L.icon({
            iconUrl: def.url,
            iconSize: [size[0], size[1]],
            iconAnchor: [anchor[0], anchor[1]],
          });
        }
        setTerritoryIcons(icons);

        const layerIndex = {};
        const overlays = {};
        function toLatLng(p) { return [totalH - p[1], p[0]]; }

        for (const f of (data.features || [])) {
          let layer = null;
          if (f.type === 'marker') {
            const icon = f.icon && icons[f.icon] ? icons[f.icon] : undefined;
            layer = addRasterMarker(f.x, f.y, icon ? { icon } : undefined);
          } else if (f.type === 'circle') {
            layer = L.circle(toLatLng(f.center), { radius: f.radius || 50, color: f.color, fillColor: f.fillColor, fillOpacity: f.fillOpacity || 0.2 }).addTo(map);
          } else if (f.type === 'polygon') {
            layer = L.polygon((f.points || []).map(toLatLng), { color: f.color, fillColor: f.fillColor, fillOpacity: f.fillOpacity || 0.2 }).addTo(map);
          } else if (f.type === 'polyline') {
            layer = L.polyline((f.points || []).map(toLatLng), { color: f.color || '#3388ff', weight: f.weight || 3 }).addTo(map);
          } else if (f.type === 'group') {
            const members = (f.members || []).map((id) => layerIndex[id]).filter(Boolean);
            layer = L.layerGroup(members).addTo(map);
            overlays[f.name || f.id || ('group-' + Object.keys(overlays).length)] = layer;
          }
          if (layer) {
            if (f.popup) layer.bindPopup(f.popup);
            if (f.id) layerIndex[f.id] = layer;
          }
        }
        if (Object.keys(overlays).length > 0) {
          L.control.layers(null, overlays, { collapsed: false, position: 'bottomleft' }).addTo(map);
        }

        // Coordinate readout
        const coordsEl = document.getElementById('coords');
        if (coordsEl) {
          map.on('mousemove', (e) => {
            const displayX = Math.max(1, Math.min(totalW, Math.floor(e.latlng.lng) + 1));
            const displayY = Math.max(1, Math.min(totalH, Math.floor(totalH - e.latlng.lat) + 1));
            coordsEl.style.display = 'block';
            coordsEl.textContent = `${displayX}x${displayY}`;
            try { if (window.handleRegionMouseMove) window.handleRegionMouseMove(e); } catch (err) {}
          });
          map.on('mouseout', () => {
            coordsEl.style.display = 'none';
            const indicator = document.getElementById('walk-indicator');
            if (indicator) indicator.classList.remove('show');
          });
        }
      }).catch((err) => console.error('Failed to load markers.json', err));

      // Flush pending collectables
      if (gameState.pendingCollectables && gameState.pendingCollectables.length > 0) {
        console.debug('Processing', gameState.pendingCollectables.length, 'pending collectables');
        const pending = [...gameState.pendingCollectables];
        gameState.pendingCollectables = [];
        pending.forEach((item) => {
          // createCollectableMarker is inside socket-client — use window fallback
          if (typeof window.createCollectableMarker === 'function') window.createCollectableMarker(item);
        });
      }

      resolve({ map, totalH, totalW });
    };

    probe.onerror = () => {
      console.error('Failed to load probe tile:', probe.src);
      try { document.getElementById('map').innerText = 'Failed to load tiles. Check tiles/ filenames.'; } catch (e) {}
      reject(new Error('Tile probe failed'));
    };
  });
}
