(function(){
  // Build Path module - creates panel, handles clicks and polyline drawing
  const tpl = `
  <div id="build-path-panel" style="position: absolute; right: 12px; bottom: 140px; width: 560px; background: #1a1a1a; border: 1px solid #333; box-shadow: 0 4px 16px rgba(0,0,0,0.8); z-index: 1000; display: none; flex-direction: column; font-family: 'MS Sans Serif', Arial, sans-serif;">
    <div id="build-path-header" style="padding: 3px 4px; background: linear-gradient(180deg, #000080 0%, #1084d0 100%); cursor: move; display: flex; justify-content: space-between; align-items: center; user-select: none;">
      <h2 style="margin: 0; flex: 1; font-size: 11px; font-weight: 700; color: #ffffff;">Build Path</h2>
      <div style="display:flex;gap:8px;align-items:center">
        <label style="display:flex;align-items:center;gap:6px;color:#fff;font-size:11px;margin-right:6px;"><input id="build-path-toggle-paths" type="checkbox" style="transform:scale(1.1)" /> <span>Show paths</span></label>
        <label style="display:flex;align-items:center;gap:6px;color:#fff;font-size:11px;margin-right:6px;"><input id="build-path-toggle-regions" type="checkbox" style="transform:scale(1.1)" /> <span>Show regions</span></label>
        <label style="display:flex;align-items:center;gap:6px;color:#fff;font-size:11px;margin-right:6px;"><span style="font-size:11px;color:#fff">Mode</span>
          <select id="build-path-mode" style="margin-left:6px;padding:2px 6px;font-size:11px;background:#222;color:#fff;border:1px solid #333;">
            <option value="path">Path</option>
            <option value="area">Area</option>
          </select>
        </label>
        <button id="build-path-clear" class="btn" style="width:auto;padding:4px 8px;">Clear</button>
        <button id="build-path-copy" class="btn" style="width:auto;padding:4px 8px;">Copy</button>
        <button id="build-path-close" class="btn" style="width:auto;padding:4px 8px;">Close</button>
      </div>
    </div>
    <div style="padding:8px">
      <p style="color:#e0e0e0;font-size:11px;margin-bottom:8px;">Click on the map to append coordinates to the textarea below.</p>
      <textarea id="build-path-textarea" rows="10" style="width:100%;background:#111;border:1px solid #222;color:#e0e0e0;padding:8px;font-family: monospace; font-size:12px;"></textarea>
    </div>
  </div>
  `;

  function ensurePanel() {
    if (document.getElementById('build-path-panel')) return document.getElementById('build-path-panel');
    const wrap = document.createElement('div');
    wrap.innerHTML = tpl;
    document.body.appendChild(wrap.firstElementChild);
    return document.getElementById('build-path-panel');
  }

  function parseTextareaToPoints(ta) {
    const pts = [];
    if (!ta || !ta.value) return pts;
    const re = /\[\s*(\d+)\s*,\s*(\d+)\s*\]/g;
    let m;
    while ((m = re.exec(ta.value)) !== null) {
      pts.push([parseInt(m[1],10), parseInt(m[2],10)]);
    }
    return pts;
  }

  function formatPointsToTextarea(points) {
    // group 4 positions per line
    const perLine = 4;
    let out = '';
    for (let i = 0; i < points.length; i += perLine) {
      const slice = points.slice(i, i + perLine);
      const line = slice.map(p => `[${p[0]}, ${p[1]}]`).join(', ');
      out += '  ' + line + ',\n';
    }
    return out;
  }

  function updateBuildPathPolyline() {
    try {
      if (typeof map === 'undefined' || !map) return;
      const gp = (typeof gameState !== 'undefined' && gameState && gameState.buildPathPoints) ? gameState.buildPathPoints : [];
      const pts = gp.map(p => [ totalH - p[1], p[0] ]);
      if (typeof gameState !== 'undefined' && gameState && gameState.buildPathPolyline) {
        try { map.removeLayer(gameState.buildPathPolyline); } catch(e){}
        gameState.buildPathPolyline = null;
      }
      if (pts.length === 0) return;
      const mode = (gameState && gameState.buildMode) ? gameState.buildMode : 'path';
      if (mode === 'area') {
        // draw filled polygon for area mode
        gameState.buildPathPolyline = L.polygon(pts, { color: '#ffea00', weight: 2, opacity: 0.95, fillColor: '#ffea00', fillOpacity: 0.25 }).addTo(map);
      } else {
        // default: polyline path (solid line)
        gameState.buildPathPolyline = L.polyline(pts, { color: '#ffff00', weight: 3, opacity: 0.9 }).addTo(map);
      }
      try { gameState.buildPathPolyline.bringToFront(); } catch(e){}
    } catch (e) { console.error('build-path:updateBuildPathPolyline', e); }
  }

  // Load and render paths (moved here from index.html)
  async function loadAndRenderPaths(){
    try {
      // remove existing paths layer
      if (gameState.pathsLayer) {
        try { map.removeLayer(gameState.pathsLayer); } catch(e){}
        gameState.pathsLayer = null;
      }

      // Use cached paths data from WebSocket
      const paths = gameState.pathsData || [];
      if (paths.length === 0) {
        console.warn('No paths data available yet');
        return;
      }

      const layers = [];
      for (const p of paths) {
        const pos = p.positions || [];
        console.debug('loadAndRenderPaths: path', p.name, 'raw positions', pos);
        const latlngs = positionsToLatLngs(pos);
        console.debug('loadAndRenderPaths: latlngs', latlngs);
        if (!latlngs || latlngs.length === 0) continue;
        const poly = L.polyline(latlngs, { color: p.loop ? '#ff00ff' : '#3388ff', weight: 4, opacity: 0.95 }).addTo(map);
        try { poly.bringToFront(); } catch (e) {}
        poly.bindPopup(`<b>${p.name}</b><br>Points: ${latlngs.length}`);
        layers.push(poly);
      }

      if (layers.length > 0) {
        gameState.pathsLayer = L.layerGroup(layers).addTo(map);
      }
    } catch (err) {
      console.error('Failed to load paths:', err);
    }
  }

  // regions loading/mount moved to public/regions.js
  // expose paths loader for backward compatibility
  window.loadAndRenderPaths = loadAndRenderPaths;

  // Walk path rendering API - keep walker state here so build-path.js owns walk drawing
  function internalDrawWalkPath(positions) {
    try {
      // positions: full array of [x,y] in raster coords, or null to clear
      if (!positions) {
        if (gameState.walkPathPolyline) { try { map.removeLayer(gameState.walkPathPolyline); } catch (e) {} gameState.walkPathPolyline = null; }
        gameState.walkerPositions = null;
        gameState.walkerCurrentIndex = 0;
        return;
      }

      gameState.walkerPositions = positions;
      if (typeof gameState.walkerCurrentIndex === 'undefined' || gameState.walkerCurrentIndex === null) gameState.walkerCurrentIndex = 0;

      const remaining = (gameState.walkerPositions || []).slice(gameState.walkerCurrentIndex || 0);
      const latlngs = (typeof positionsToLatLngs === 'function') ? positionsToLatLngs(remaining || []) : remaining.map(p => [ totalH - p[1], p[0] ]);

      if (!latlngs || latlngs.length === 0) {
        if (gameState.walkPathPolyline) { try { map.removeLayer(gameState.walkPathPolyline); } catch (e) {} gameState.walkPathPolyline = null; }
        return;
      }

      if (gameState.walkPathPolyline) {
        try { gameState.walkPathPolyline.setLatLngs(latlngs); } catch (e) {}
      } else {
        gameState.walkPathPolyline = L.polyline(latlngs, { color: '#ffd700', weight: 3, opacity: 0.9 }).addTo(map);
        try { gameState.walkPathPolyline.bringToFront(); } catch (e) {}
      }
    } catch (e) { console.error('build-path:internalDrawWalkPath', e); }
  }

  function setWalkerPositions(positions, currentIndex) {
    gameState.walkerPositions = positions || null;
    gameState.walkerCurrentIndex = typeof currentIndex === 'number' ? currentIndex : (gameState.walkerCurrentIndex || 0);
    internalDrawWalkPath(gameState.walkerPositions);
  }

  function updateWalkerCurrentIndex(idx) {
    if (typeof idx !== 'number') return;
    gameState.walkerCurrentIndex = idx;
    internalDrawWalkPath(gameState.walkerPositions || []);
  }

  function clearWalkerPath() {
    internalDrawWalkPath(null);
  }

  function onMapClick(e) {
    try {
      const panel = document.getElementById('build-path-panel');
      if (!panel || panel.style.display === 'none') return;
      const x = Math.round(e.latlng.lng);
      const y = Math.round(totalH - e.latlng.lat);
      const ta = document.getElementById('build-path-textarea');
      gameState.buildPathPoints = gameState.buildPathPoints || [];
      gameState.buildPathPoints.push([x,y]);
      // rebuild formatted textarea with 4 positions per row
      if (ta) {
        ta.value = formatPointsToTextarea(gameState.buildPathPoints);
        ta.scrollTop = ta.scrollHeight;
      }
      updateBuildPathPolyline();
    } catch (err) { console.error('build-path:onMapClick', err); }
  }

  function wireDrag(header, panel) {
    let isDragging = false; let currentX; let currentY; let initialX; let initialY; let xOffset = 0; let yOffset = 0;
    function setTranslate(xPos, yPos, el){ el.style.transform = `translate3d(${xPos}px, ${yPos}px, 0)`; }
    function dragStart(e){ initialX = e.clientX - xOffset; initialY = e.clientY - yOffset; isDragging = true; }
    function drag(e){ if(isDragging){ e.preventDefault(); currentX = e.clientX - initialX; currentY = e.clientY - initialY; xOffset = currentX; yOffset = currentY; setTranslate(currentX, currentY, panel); } }
    function dragEnd(e){ initialX = currentX; initialY = currentY; isDragging = false; }
    header.addEventListener('mousedown', dragStart);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', dragEnd);
  }

  function showPanel() {
    const panel = ensurePanel();
    panel.style.display = 'flex';
    gameState.buildPathMode = true;
    const ta = document.getElementById('build-path-textarea');

    // show paths and regions by default when opening the builder
    try {
      gameState.showPaths = true;
      gameState.showRegions = true;
      const tp = document.getElementById('build-path-toggle-paths');
      const tr = document.getElementById('build-path-toggle-regions');
      if (tp) tp.checked = true;
      if (tr) tr.checked = true;
      if (typeof loadAndRenderPaths === 'function') loadAndRenderPaths();
      if (typeof loadAndRenderRegions === 'function') loadAndRenderRegions();
    } catch (e) { console.error('build-path:showPanel init layers', e); }

    // update polyline when textarea changes (handles deletions)
    if (ta) {
      ta.addEventListener('input', () => {
        try {
          gameState.buildPathPoints = parseTextareaToPoints(ta);
          updateBuildPathPolyline();
        } catch (e) { console.error('build-path:textarea input', e); }
      });
    }
    try {
      gameState.buildPathPoints = [];
      if (ta && ta.value) gameState.buildPathPoints = parseTextareaToPoints(ta);
      if (gameState.buildPathPoints.length > 0) updateBuildPathPolyline();
    } catch(e) { console.error('build-path:hydrate', e); }
    if (ta) ta.focus();
  }

  function hidePanel() {
    const panel = document.getElementById('build-path-panel');
    if (!panel) return;
    panel.style.display = 'none';
    gameState.buildPathMode = false;
    try {
      // remove any drawn build polyline
      if (gameState.buildPathPolyline) { try { map.removeLayer(gameState.buildPathPolyline); } catch(e){} gameState.buildPathPolyline = null; }

      // remove paths layer
      if (gameState.pathsLayer) { try { map.removeLayer(gameState.pathsLayer); } catch(e){} gameState.pathsLayer = null; }
      // remove regions layer
      if (gameState.regionsLayer) { try { map.removeLayer(gameState.regionsLayer); } catch(e){} gameState.regionsLayer = null; }

      // clear toggles and flags
      gameState.showPaths = false;
      gameState.showRegions = false;
      const tp = document.getElementById('build-path-toggle-paths');
      const tr = document.getElementById('build-path-toggle-regions');
      if (tp) try { tp.checked = false; } catch(e){}
      if (tr) try { tr.checked = false; } catch(e){}
    } catch (e) { console.error('build-path:hidePanel cleanup', e); }
  }

  function init() {
    const panel = ensurePanel();
    const header = document.getElementById('build-path-header');
    const clearBtn = document.getElementById('build-path-clear');
    const closeBtn = document.getElementById('build-path-close');
    const copyBtn = document.getElementById('build-path-copy');
    const togglePaths = document.getElementById('build-path-toggle-paths');
    const toggleRegions = document.getElementById('build-path-toggle-regions');
    const modeSelect = document.getElementById('build-path-mode');
    const ta = document.getElementById('build-path-textarea');

    wireDrag(header, panel);

    if (clearBtn) clearBtn.addEventListener('click', () => {
      if (ta) ta.value = '';
      gameState.buildPathPoints = [];
      if (gameState.buildPathPolyline) { try { map.removeLayer(gameState.buildPathPolyline); } catch(e){} gameState.buildPathPolyline = null; }
    });

    if (closeBtn) closeBtn.addEventListener('click', () => { try { hidePanel(); } catch(e){ console.error('build-path:close', e); } });

    if (copyBtn) copyBtn.addEventListener('click', async () => {
      try {
        if (!ta) return;
        if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(ta.value);
        else { const tmp = document.createElement('textarea'); tmp.value = ta.value; document.body.appendChild(tmp); tmp.select(); document.execCommand('copy'); document.body.removeChild(tmp); }
      } catch (e) { console.error('build-path:copy', e); }
    });

    // wire show/hide paths toggle
    if (togglePaths) {
      // initialize toggle from gameState
      try { togglePaths.checked = !!(gameState && gameState.showPaths); } catch (e) {}
      togglePaths.addEventListener('change', async () => {
        try {
          gameState.showPaths = !!togglePaths.checked;
          if (gameState.showPaths) {
            if (typeof loadAndRenderPaths === 'function') await loadAndRenderPaths();
          } else {
            // remove paths layer if present
            if (gameState.pathsLayer) { try { map.removeLayer(gameState.pathsLayer); } catch (e) {} gameState.pathsLayer = null; }
          }
        } catch (e) { console.error('build-path:togglePaths', e); }
      });
    }

    if (toggleRegions) {
      try { toggleRegions.checked = !!(gameState && gameState.showRegions); } catch (e) {}
      toggleRegions.addEventListener('change', async () => {
        try {
          gameState.showRegions = !!toggleRegions.checked;
          if (gameState.showRegions) {
            if (typeof loadAndRenderRegions === 'function') await loadAndRenderRegions();
          } else {
            if (gameState.regionsLayer) { try { map.removeLayer(gameState.regionsLayer); } catch (e) {} gameState.regionsLayer = null; }
          }
        } catch (e) { console.error('build-path:toggleRegions', e); }
      });
    }

    // wire mode select
    if (modeSelect) {
      try { if (!gameState.buildMode) gameState.buildMode = 'path'; modeSelect.value = gameState.buildMode; } catch(e){}
      modeSelect.addEventListener('change', () => {
        try {
          gameState.buildMode = modeSelect.value === 'area' ? 'area' : 'path';
          // redraw
          updateBuildPathPolyline();
        } catch(e) { console.error('build-path:mode change', e); }
      });
    }

    // expose public API
    window.buildPath = {
      init,
      showPanel,
      hidePanel,
      onMapClick,
      updateBuildPathPolyline,
      // Walk path API
      drawWalkPath: internalDrawWalkPath,
      setWalkerPositions,
      updateWalkerCurrentIndex,
      clearWalkerPath
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
