(function(){
  // regions module: load/render regions, hover indicator, permission checks
  let mapRef = null;
  let gameStateRef = null;
  let apiCallRef = null;
  let positionsToLatLngsRef = null;

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
    const img = document.createElement('img'); img.src = 'assets/icons/walk.gif';
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
    `;
    const style = document.createElement('style'); style.appendChild(document.createTextNode(css)); document.head.appendChild(style);
    const win = document.createElement('div'); win.id = 'game-log-window'; win.className = 'game-log-window'; win.style.display = 'none';
    document.body.appendChild(win);

    window.addLogMessage = function(message, level = 'info') {
      try {
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
      if (!mapRef || !apiCallRef) return [];
      if (gameStateRef.regionsLayer) {
        try { mapRef.removeLayer(gameStateRef.regionsLayer); } catch(e){}
        gameStateRef.regionsLayer = null;
      }

      const data = await apiCallRef('/regions');
      const regions = data.regions || [];
      try { if (typeof gameStateRef !== 'undefined') gameStateRef.regionsData = regions; } catch(e){}

      const layers = [];
      for (const r of regions) {
        const pos = r.coordinates || r.positions || [];
        const latlngs = positionsToLatLngsRef ? positionsToLatLngsRef(pos) : [];
        if (!latlngs || latlngs.length === 0) continue;
        const fill = (r.properties && r.properties.fillColor) ? r.properties.fillColor : (r.type === 'danger' ? '#ff5555' : '#55ff55');
        const stroke = (r.properties && r.properties.color) ? r.properties.color : '#228822';
        const poly = L.polygon(latlngs, { color: stroke, weight: 2, opacity: 0.9, fillColor: fill, fillOpacity: 0.25, interactive: false });
        try { poly.addTo(mapRef); poly.bringToFront(); } catch (e) {}
        layers.push(poly);
      }

      if (layers.length > 0) {
        gameStateRef.regionsLayer = L.layerGroup(layers).addTo(mapRef);
      }

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
      if ((!gameStateRef.regionsData || gameStateRef.regionsData.length === 0) && !gameStateRef._regionsLoading) {
        try {
          gameStateRef._regionsLoading = true;
          const d = await apiCallRef('/regions');
          gameStateRef.regionsData = d.regions || [];
        } catch (e) {
          console.debug('Failed to load regions for permission check', e);
          gameStateRef._regionsLoading = false;
          return false;
        }
        gameStateRef._regionsLoading = false;
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
      if ((!regions || regions.length === 0) && !gameStateRef._regionsLoading) {
        try {
          gameStateRef._regionsLoading = true;
          apiCallRef('/regions').then(d => { try { gameStateRef.regionsData = d.regions || []; } catch(e){} gameStateRef._regionsLoading = false; }).catch(() => { gameStateRef._regionsLoading = false; });
        } catch (e) { gameStateRef._regionsLoading = false; }
      }

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
          
          // After user zooms, only show regions at min zoom level
          if (userHasZoomed) {
            if (isMinZoom) {
              if (!gameStateRef.regionsLayer) {
                try {
                  const data = await apiCallRef('/regions');
                  const regions = data.regions || [];
                  gameStateRef.regionsData = regions;
                  const layers = [];
                  for (const r of regions) {
                    const pos = r.coordinates || r.positions || [];
                    const latlngs = positionsToLatLngsRef ? positionsToLatLngsRef(pos) : [];
                    if (!latlngs || latlngs.length === 0) continue;
                    const fill = (r.properties && r.properties.fillColor) ? r.properties.fillColor : (r.type === 'danger' ? '#ff5555' : '#55ff55');
                    const stroke = (r.properties && r.properties.color) ? r.properties.color : '#228822';
                    const poly = L.polygon(latlngs, { color: stroke, weight: 2, opacity: 0.9, fillColor: fill, fillOpacity: 0.25, interactive: false });
                    layers.push(poly);
                  }
                  if (layers.length > 0) {
                    gameStateRef.regionsLayer = L.layerGroup(layers).addTo(mapRef);
                  }
                } catch (err) { /* ignore */ }
              }
            } else {
              // Remove regions when not at min zoom (after user has zoomed)
              if (gameStateRef.regionsLayer) { 
                try { mapRef.removeLayer(gameStateRef.regionsLayer); } catch(e){} 
                gameStateRef.regionsLayer = null; 
              }
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
