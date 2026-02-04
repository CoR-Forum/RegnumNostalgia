(function(){
  // regions module: load/render regions, hover indicator, permission checks
  let mapRef = null;
  let gameStateRef = null;
  let apiCallRef = null;
  let positionsToLatLngsRef = null;

  // Fallback realm colors in case getRealmColor isn't provided by the page
  const FALLBACK_REALM_COLORS = { syrtis: '#22c55e', alsius: '#3b82f6', ignis: '#ef4444' };
  const CITY_FILL = '#ffcc99';
  const CITY_STROKE = '#d08a4d';

  function resolveRealmColor(owner) {
    try {
      if (typeof getRealmColor === 'function') return getRealmColor(owner);
      const key = (owner || 'syrtis');
      return FALLBACK_REALM_COLORS[key] || FALLBACK_REALM_COLORS.syrtis;
    } catch (e) {
      return FALLBACK_REALM_COLORS.syrtis;
    }
  }

  function darkenHex(hex, amount) {
    try {
      const col = hex.replace('#','');
      const num = parseInt(col,16);
      let r = (num >> 16) + amount;
      let g = ((num >> 8) & 0x00FF) + amount;
      let b = (num & 0x0000FF) + amount;
      r = Math.max(0, Math.min(255, r));
      g = Math.max(0, Math.min(255, g));
      b = Math.max(0, Math.min(255, b));
      return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    } catch (e) { return hex; }
  }

  function pointInPolygon(x, y, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0], yi = polygon[i][1];
      const xj = polygon[j][0], yj = polygon[j][1];
      const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 0.0) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function createWalkIndicator(){
    const css = `
      .walk-indicator{position:fixed;pointer-events:none;z-index:99999;width:24px;height:24px;opacity:0;transition:opacity 120ms linear;will-change:transform,left,top;}
      .walk-indicator.show{opacity:1;animation:walk-bounce 600ms steps(2) infinite;}
      .walk-indicator img{width:24px;height:24px;display:block}
      @keyframes walk-bounce{0%{transform:translateY(0);}50%{transform:translateY(-4px);}100%{transform:translateY(0);}}
    `;
    const style = document.createElement('style'); style.appendChild(document.createTextNode(css)); document.head.appendChild(style);
    const el = document.createElement('div'); el.id = 'walk-indicator'; el.className = 'walk-indicator';
    const img = document.createElement('img'); img.src = 'assets/markers/walk.gif';
    img.alt = 'walk';
    img.onerror = function(){ el.textContent = '🚶'; };
    img.onload = function(){};
    el.appendChild(img);
    document.body.appendChild(el);
  }

  function createLogWindow(){
    const css = `
      .game-log-window{position:fixed;left:8px;bottom:8px;width:280px;max-height:140px;overflow:auto;background:rgba(0,0,0,0.75);color:#fff;padding:8px;border-radius:6px;font-size:12px;z-index:200000;box-shadow:0 4px 16px rgba(0,0,0,0.6);} 
      .game-log-entry{margin-bottom:6px;padding:6px;border-radius:4px;background:rgba(255,255,255,0.02);} 
      .game-log-entry.error{background:rgba(255,64,64,0.08);color:#ffdcdc} 
      .game-log-ts{display:block;font-size:11px;opacity:0.7;margin-bottom:3px} 
      /* Error overlay: centered horizontally, 30% from top, big golden text, minimal styling */
      #game-error-overlay{position:fixed;top:18vh;left:50%;transform:translateX(-50%);z-index:300000;text-align:center;pointer-events:none;display:none;max-width:40%;}
      #game-error-overlay .game-error-msg{color:#ffd700;font-size:18px;font-weight:800;text-align:center;white-space:normal;overflow-wrap:break-word;word-wrap:break-word;}
      #game-error-overlay{display:flex;flex-direction:column;gap:6px;align-items:center;}
    `;
    const style = document.createElement('style'); style.appendChild(document.createTextNode(css)); document.head.appendChild(style);
    const win = document.createElement('div'); win.id = 'game-log-window'; win.className = 'game-log-window'; win.style.display = 'none';
    document.body.appendChild(win);

    const err = document.createElement('div'); err.id = 'game-error-overlay'; document.body.appendChild(err);

    // track messages and timers so we can stack up to N messages
    const _errorMessages = [];
    const _ERROR_MAX = 5;

    function removeErrorMessageObj(obj){
      try{
        const idx = _errorMessages.indexOf(obj);
        if(idx !== -1) _errorMessages.splice(idx,1);
        if(obj && obj.el && obj.el.parentNode) obj.el.parentNode.removeChild(obj.el);
        if(obj && obj.timer) clearTimeout(obj.timer);
      }catch(e){}
      // hide container if empty
      try{ const container = document.getElementById('game-error-overlay'); if(container && _errorMessages.length === 0) container.style.display = 'none'; }catch(e){}
    }

    window.addLogMessage = function(message, level = 'info') {
      try {
        if (level === 'error') {
          const container = document.getElementById('game-error-overlay'); if (!container) return;
          // create message element
          const msgEl = document.createElement('div'); msgEl.className = 'game-error-msg'; msgEl.textContent = message;
          // insert newest at the top so they stack downward with newest first
          container.insertBefore(msgEl, container.firstChild);
          container.style.display = 'flex';

          // create object with timer to auto-remove
          const obj = { el: msgEl, timer: null };
          // enforce max messages: if over limit, remove oldest (the last element)
          if (_errorMessages.length >= _ERROR_MAX) {
            const oldest = _errorMessages.pop();
            try{ if (oldest && oldest.el && oldest.el.parentNode) oldest.el.parentNode.removeChild(oldest.el); if (oldest.timer) clearTimeout(oldest.timer); }catch(e){}
          }
          // add newest to the start of the array
          _errorMessages.unshift(obj);

          // each message auto-hides after 6s
          obj.timer = setTimeout(() => { removeErrorMessageObj(obj); }, 6000);
          return;
        }

        // Non-error messages: fall back to the small game log window
        const w = document.getElementById('game-log-window'); if (!w) return;
        const entry = document.createElement('div'); entry.className = 'game-log-entry ' + (level === 'error' ? 'error' : '');
        const ts = document.createElement('span'); ts.className = 'game-log-ts'; ts.textContent = new Date().toLocaleTimeString();
        const txt = document.createElement('div'); txt.textContent = message;
        entry.appendChild(ts); entry.appendChild(txt);
        w.appendChild(entry);
        w.style.display = 'block';
        w.scrollTop = w.scrollHeight;
        const entries = w.querySelectorAll('.game-log-entry'); if (entries.length > 20) entries[0].remove();
        setTimeout(() => { try { if (w) { if (entry.parentNode) entry.parentNode.removeChild(entry); if (w.children.length === 0) w.style.display = 'none'; } } catch(e){} }, 6000);
      } catch (e) { console.error('addLogMessage failed', e); }
    };
  }

  async function loadAndRenderRegions(){
    try {
      console.debug('loadAndRenderRegions invoked');
      if (!mapRef || !apiCallRef) return [];
      if (gameStateRef.regionsLayer) {
        try { mapRef.removeLayer(gameStateRef.regionsLayer); } catch(e){}
        gameStateRef.regionsLayer = null;
      }

      // Use cached regions data from WebSocket
      const regions = gameStateRef.regionsData || [];
      if (regions.length === 0) {
        console.warn('No regions data available yet, waiting for WebSocket...');
        // Wait a bit for WebSocket data to arrive
        await new Promise(resolve => setTimeout(resolve, 500));
        const regionsRetry = gameStateRef.regionsData || [];
        if (regionsRetry.length === 0) {
          console.error('Regions data still not available');
          return [];
        }
        return loadAndRenderRegions(); // Try again now that data might be loaded
      }

      const layers = [];
      for (const r of regions) {
        const pos = r.coordinates || r.positions || [];
        const latlngs = positionsToLatLngsRef ? positionsToLatLngsRef(pos) : [];
        if (!latlngs || latlngs.length === 0) continue;
        // Determine fill/stroke: cities are always light orange, otherwise use realm color
        let fill, stroke;
        if (r && String(r.type) === 'city') {
          fill = CITY_FILL;
          stroke = CITY_STROKE;
        } else {
          const realmColor = resolveRealmColor(r.owner);
          fill = realmColor;
          stroke = darkenHex(realmColor, -30);
        }
        const poly = L.polygon(latlngs, { color: stroke, weight: 2, opacity: 0.9, fillColor: fill, fillOpacity: 0.25, interactive: false });
        try { poly.addTo(mapRef); poly.bringToFront(); } catch (e) {}
        layers.push(poly);
      }

      if (layers.length > 0) {
        gameStateRef.regionsLayer = L.layerGroup(layers).addTo(mapRef);
      }
      console.debug('loadAndRenderRegions: rendered', layers.length, 'region layers');

      return regions;
    } catch (err) {
      console.error('Failed to load regions:', err);
      return [];
    }
  }

  function isLatLngWalkAllowed(latlng) {
    try {
      const x = Math.round(latlng.lng);
      const y = Math.round((typeof window.totalH !== 'undefined' ? window.totalH : 6144) - latlng.lat);
      if (x < 0 || x > 6144 || y < 0 || y > 6144) return false;
      const regions = (gameStateRef && gameStateRef.regionsData) ? gameStateRef.regionsData : [];
      for (const r of regions) {
        const poly = r.coordinates || r.positions || [];
        if (!poly || poly.length === 0) continue;
        if (pointInPolygon(x, y, poly)) {
          const ownerMatches = (r.owner === null || typeof r.owner === 'undefined') ? true : (String(r.owner) === String(gameStateRef.realm));
          const walkable = (typeof r.walkable !== 'undefined') ? !!r.walkable : true;
          const isWarzone = (r.type === 'warzone');
          return isWarzone || (walkable && ownerMatches);
        }
      }
      return true;
    } catch (e) { console.debug('isLatLngWalkAllowed error', e); return true; }
  }

  async function isLatLngWalkAllowedAsync(latlng) {
    try {
      // Regions loaded via WebSocket on connection
      if (!gameStateRef.regionsData || gameStateRef.regionsData.length === 0) {
        console.debug('Regions not loaded yet, allowing walk');
        return true;
      }
      
      return isLatLngWalkAllowed(latlng);
    } catch (e) { console.debug('isLatLngWalkAllowedAsync error', e); return false; }
  }

  function handleRegionMouseMove(e) {
    try {
      if (!mapRef) return;
      const mapX = e.latlng.lng;
      const mapY = e.latlng.lat;
      const rx = Math.round(mapX);
      const ry = Math.round((typeof window.totalH !== 'undefined' ? window.totalH : 6144) - mapY);
      let allowed = false;
      let foundRegion = null;
      const regions = (gameStateRef && gameStateRef.regionsData) ? gameStateRef.regionsData : [];
      // Regions loaded via WebSocket on connection

      for (const r of (gameStateRef.regionsData || [])) {
        const poly = r.coordinates || r.positions || [];
        if (!poly || poly.length === 0) continue;
        if (pointInPolygon(rx, ry, poly)) {
          foundRegion = r;
          const ownerMatches = (r.owner === null || typeof r.owner === 'undefined') ? true : (String(r.owner) === String(gameStateRef.realm));
          const walkable = (typeof r.walkable !== 'undefined') ? !!r.walkable : true;
          const isWarzone = (r.type === 'warzone');
          allowed = isWarzone || (walkable && ownerMatches);
          break;
        }
      }

      const indicator = document.getElementById('walk-indicator');
      if (allowed) {
        if (indicator) {
          let cx = null, cy = null;
          if (e && e.originalEvent && typeof e.originalEvent.clientX === 'number') {
            cx = e.originalEvent.clientX; cy = e.originalEvent.clientY;
          } else if (e && typeof mapRef.latLngToContainerPoint === 'function') {
            try {
              const cp = mapRef.latLngToContainerPoint(e.latlng);
              const rect = mapRef.getContainer().getBoundingClientRect();
              cx = rect.left + cp.x; cy = rect.top + cp.y;
            } catch (err) {}
          }
          if (cx !== null && cy !== null) {
            indicator.style.left = (cx + 16) + 'px';
            indicator.style.top = (cy + 16) + 'px';
          }
          indicator.classList.add('show');
        }
      } else {
        if (indicator) indicator.classList.remove('show');
      }
    } catch (err) { console.debug('region hover check error', err); }
  }

  function initRegionDisplay(map, gameState, apiCall, positionsToLatLngs) {
    mapRef = map; gameStateRef = gameState; apiCallRef = apiCall; positionsToLatLngsRef = positionsToLatLngs;
    try { createWalkIndicator(); } catch(e){}
    try { createLogWindow(); } catch(e){}

    // wire mouse handlers: expose a handler that index.html calls from its mousemove coords block
    window.handleRegionMouseMove = handleRegionMouseMove;

    // wire map mouseout
    try { mapRef.on('mouseout', () => { const indicator = document.getElementById('walk-indicator'); if (indicator) indicator.classList.remove('show'); }); } catch(e){}

    // zoomend overview rendering - show regions on min zoom after user interaction
    try {
      // Track if user has zoomed (to differentiate initial load from user zoom)
      let userHasZoomed = false;
      mapRef.on('zoomstart', () => { userHasZoomed = true; });
      
      mapRef.on('zoomend', async () => {
        try {
          const currentZoom = mapRef.getZoom();
          const isMinZoom = typeof mapRef.getMinZoom === 'function' && currentZoom === mapRef.getMinZoom();

          // If user has interacted by zooming, show an overview of regions at min zoom
          // even if the user hasn't explicitly toggled regions on. If the user has
          // toggled regions on, keep them visible at all zoom levels.
          if (userHasZoomed) {
            if (gameStateRef.showRegions) {
              // User explicitly enabled regions: ensure they're rendered at any zoom.
              if (!gameStateRef.regionsLayer) {
                try {
                  const regions = gameStateRef.regionsData || [];
                  if (regions.length === 0) {
                    console.warn('No regions data available yet');
                    return;
                  }
                  const layers = [];
                  for (const r of regions) {
                    const pos = r.coordinates || r.positions || [];
                    const latlngs = positionsToLatLngsRef ? positionsToLatLngsRef(pos) : [];
                    if (!latlngs || latlngs.length === 0) continue;
                    // Determine fill/stroke: cities are always light orange, otherwise use realm color
                    let fill, stroke;
                    if (r && String(r.type) === 'city') {
                      fill = CITY_FILL;
                      stroke = CITY_STROKE;
                    } else {
                      const realmColor = resolveRealmColor(r.owner);
                      fill = realmColor;
                      stroke = darkenHex(realmColor, -30);
                    }
                    const poly = L.polygon(latlngs, { color: stroke, weight: 2, opacity: 0.9, fillColor: fill, fillOpacity: 0.25, interactive: false });
                    layers.push(poly);
                  }
                  if (layers.length > 0) {
                    gameStateRef.regionsLayer = L.layerGroup(layers).addTo(mapRef);
                  }
                } catch (err) { /* ignore */ }
              }
            } else {
              // User hasn't enabled regions: only show them when at min zoom as an overview.
              if (isMinZoom) {
                if (!gameStateRef.regionsLayer) {
                  try {
                    const regions = gameStateRef.regionsData || [];
                    if (regions.length === 0) {
                      console.warn('No regions data available yet');
                      return;
                    }
                    const layers = [];
                    for (const r of regions) {
                      const pos = r.coordinates || r.positions || [];
                      const latlngs = positionsToLatLngsRef ? positionsToLatLngsRef(pos) : [];
                      if (!latlngs || latlngs.length === 0) continue;
                      // Determine fill/stroke: cities are always light orange, otherwise use realm color
                      let fill, stroke;
                      if (r && String(r.type) === 'city') {
                        fill = CITY_FILL;
                        stroke = CITY_STROKE;
                      } else {
                        const realmColor = resolveRealmColor(r.owner);
                        fill = realmColor;
                        stroke = darkenHex(realmColor, -30);
                      }
                      const poly = L.polygon(latlngs, { color: stroke, weight: 2, opacity: 0.9, fillColor: fill, fillOpacity: 0.25, interactive: false });
                      layers.push(poly);
                    }
                    if (layers.length > 0) {
                      gameStateRef.regionsLayer = L.layerGroup(layers).addTo(mapRef);
                    }
                  } catch (err) { /* ignore */ }
                }
              } else {
                if (gameStateRef.regionsLayer) {
                  try { mapRef.removeLayer(gameStateRef.regionsLayer); } catch (e) {}
                  gameStateRef.regionsLayer = null;
                }
              }

            // Paths overview: only render paths when the Region Editor is open.
            // Paths must not appear on initial load or when zooming out unless
            // the editor UI (`buildPathMode`) is active.
            try {
              if (gameStateRef.buildPathMode) {
                // Editor open: render paths if not already rendered
                if (!gameStateRef.pathsLayer && typeof window.loadAndRenderPaths === 'function') {
                  try { await window.loadAndRenderPaths(); } catch (e) { /* ignore */ }
                }
              } else {
                // Editor closed: ensure paths are removed and never auto-shown
                if (gameStateRef.pathsLayer) {
                  try { mapRef.removeLayer(gameStateRef.pathsLayer); } catch (e) {}
                  gameStateRef.pathsLayer = null;
                }
              }
            } catch (err) { /* ignore path overview errors */ }
            }
          }
        } catch (err) { console.debug('zoomend regions error', err); }
      });
    } catch(e){}

    // expose loadAndRenderRegions globally
    window.loadAndRenderRegions = loadAndRenderRegions;
    // expose permission helpers
    window.isLatLngWalkAllowed = isLatLngWalkAllowed;
    window.isLatLngWalkAllowedAsync = isLatLngWalkAllowedAsync;
  }

  // expose init
  window.initRegionDisplay = initRegionDisplay;
})();
