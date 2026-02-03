(function(){
  // Build Path module - creates panel, handles clicks and polyline drawing
  const tpl = `
  <div id="build-path-panel" style="position: absolute; right: 12px; bottom: 140px; width: 800px; background: #1a1a1a; border: 1px solid #333; box-shadow: 0 4px 16px rgba(0,0,0,0.8); z-index: 1000; display: none; flex-direction: column; font-family: 'MS Sans Serif', Arial, sans-serif;">
    <div id="build-path-header" style="padding: 3px 4px; background: linear-gradient(180deg, #000080 0%, #1084d0 100%); cursor: move; display: flex; justify-content: space-between; align-items: center; user-select: none;">
      <h2 style="margin: 0; flex: 1; font-size: 11px; font-weight: 700; color: #ffffff;">Region Editor</h2>
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
    <div style="padding:8px;display:flex;gap:8px;">
      <!-- Left panel: Lists -->
      <div style="flex:0 0 280px;display:flex;flex-direction:column;gap:8px;">
        <!-- Tab switcher -->
        <div style="display:flex;gap:2px;border-bottom:1px solid #333;padding-bottom:4px;">
          <button id="tab-regions" class="editor-tab active" style="flex:1;padding:6px;background:#333;color:#fff;border:none;cursor:pointer;font-size:11px;">Regions</button>
          <button id="tab-paths" class="editor-tab" style="flex:1;padding:6px;background:#222;color:#aaa;border:none;cursor:pointer;font-size:11px;">Paths</button>
          <button id="tab-walls" class="editor-tab" style="flex:1;padding:6px;background:#222;color:#aaa;border:none;cursor:pointer;font-size:11px;">Walls</button>
        </div>
        
        <!-- List containers -->
        <div id="regions-list-container" class="list-container" style="display:block;">
          <div style="margin-bottom:8px;">
            <button id="btn-new-region" style="width:100%;padding:6px;background:#0a4;color:#fff;border:none;cursor:pointer;font-size:11px;">+ New Region</button>
          </div>
          <div id="regions-list" style="max-height:200px;overflow-y:auto;background:#111;border:1px solid #222;padding:4px;"></div>
        </div>
        
        <div id="paths-list-container" class="list-container" style="display:none;">
          <div style="margin-bottom:8px;">
            <button id="btn-new-path" style="width:100%;padding:6px;background:#0a4;color:#fff;border:none;cursor:pointer;font-size:11px;">+ New Path</button>
          </div>
          <div id="paths-list" style="max-height:200px;overflow-y:auto;background:#111;border:1px solid #222;padding:4px;"></div>
        </div>
        
        <div id="walls-list-container" class="list-container" style="display:none;">
          <div style="margin-bottom:8px;">
            <button id="btn-new-wall" style="width:100%;padding:6px;background:#0a4;color:#fff;border:none;cursor:pointer;font-size:11px;">+ New Wall</button>
          </div>
          <div id="walls-list" style="max-height:200px;overflow-y:auto;background:#111;border:1px solid #222;padding:4px;"></div>
        </div>
      </div>
      
      <!-- Right panel: Editor -->
      <div style="flex:1;display:flex;flex-direction:column;">
        <p style="color:#e0e0e0;font-size:11px;margin:0 0 8px 0;">Click on the map to append coordinates to the textarea below.</p>
        <textarea id="build-path-textarea" rows="10" style="width:100%;background:#111;border:1px solid #222;color:#e0e0e0;padding:8px;font-family: monospace; font-size:12px;"></textarea>
        <div id="editor-form" style="display:none;margin-top:8px;padding:8px;background:#111;border:1px solid #222;">
          <div style="margin-bottom:8px;">
            <label style="display:block;color:#e0e0e0;font-size:11px;margin-bottom:4px;">ID:</label>
            <input id="edit-id" type="text" style="width:100%;padding:4px;background:#222;border:1px solid #333;color:#e0e0e0;font-size:11px;" />
          </div>
          <div style="margin-bottom:8px;">
            <label style="display:block;color:#e0e0e0;font-size:11px;margin-bottom:4px;">Name:</label>
            <input id="edit-name" type="text" style="width:100%;padding:4px;background:#222;border:1px solid #333;color:#e0e0e0;font-size:11px;" />
          </div>
          <div id="region-fields" style="display:none;">
            <div style="margin-bottom:8px;">
              <label style="display:block;color:#e0e0e0;font-size:11px;margin-bottom:4px;">Type:</label>
              <select id="edit-type" style="width:100%;padding:4px;background:#222;border:1px solid #333;color:#e0e0e0;font-size:11px;">
                <option value="safe">Safe</option>
                <option value="war">War</option>
                <option value="invasion">Invasion</option>
              </select>
            </div>
            <div style="margin-bottom:8px;">
              <label style="display:block;color:#e0e0e0;font-size:11px;margin-bottom:4px;">Owner:</label>
              <select id="edit-owner" style="width:100%;padding:4px;background:#222;border:1px solid #333;color:#e0e0e0;font-size:11px;">
                <option value="syrtis">Syrtis</option>
                <option value="alsius">Alsius</option>
                <option value="ignis">Ignis</option>
                <option value="neutral">Neutral</option>
              </select>
            </div>
            <div style="margin-bottom:8px;">
              <label style="display:flex;align-items:center;gap:6px;color:#e0e0e0;font-size:11px;">
                <input id="edit-walkable" type="checkbox" style="transform:scale(1.1)" />
                <span>Walkable</span>
              </label>
            </div>
          </div>
          <div id="path-fields" style="display:none;">
            <div style="margin-bottom:8px;">
              <label style="display:flex;align-items:center;gap:6px;color:#e0e0e0;font-size:11px;">
                <input id="edit-loop" type="checkbox" style="transform:scale(1.1)" />
                <span>Loop</span>
              </label>
            </div>
          </div>
          <div style="display:flex;gap:8px;">
            <button id="btn-save" style="flex:1;padding:6px;background:#0a4;color:#fff;border:none;cursor:pointer;font-size:11px;">Save</button>
            <button id="btn-cancel" style="flex:1;padding:6px;background:#666;color:#fff;border:none;cursor:pointer;font-size:11px;">Cancel</button>
            <button id="btn-delete" style="padding:6px 12px;background:#a00;color:#fff;border:none;cursor:pointer;font-size:11px;">Delete</button>
          </div>
        </div>
      </div>
    </div>
  </div>
  `;

  function ensurePanel() {
    // Return if already created
    const existing = document.getElementById('build-path-panel');
    if (existing) return existing;

    // Try to load external HTML fragment synchronously (fallback to embedded tpl)
    let html = null;
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', '/regionEditor.html', false); // synchronous on purpose for init compatibility
      xhr.send(null);
      if (xhr.status === 200) html = xhr.responseText;
    } catch (e) {
      console.debug('Failed to load /regionEditor.html, falling back to embedded template', e);
    }

    const wrap = document.createElement('div');
    wrap.innerHTML = html || tpl;
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
      console.debug('loadAndRenderPaths invoked');
      // remove existing paths layer
      if (gameState.pathsLayer) {
        try { map.removeLayer(gameState.pathsLayer); } catch(e){}
        gameState.pathsLayer = null;
      }

      // Use cached paths data from WebSocket. If not yet populated, wait briefly and retry (WebSocket may deliver data asynchronously).
      let paths = gameState.pathsData || [];
      if (paths.length === 0) {
        console.warn('No paths data available yet, waiting for WebSocket...');
        await new Promise(resolve => setTimeout(resolve, 400));
        paths = gameState.pathsData || [];
        if (paths.length === 0) {
          console.error('Paths data still not available');
          return;
        }
      }

      const layers = [];
      for (const p of paths) {
        const pos = p.positions || [];
        console.debug('loadAndRenderPaths: path', p.name, 'raw positions', pos);
        const latlngs = (typeof positionsToLatLngs === 'function') ? positionsToLatLngs(pos) : (pos||[]).map(p => {
          if (Array.isArray(p)) return [ totalH - p[1], p[0] ];
          return [ totalH - (p.y ?? p[1] ?? 0), (p.x ?? p[0] ?? 0) ];
        });
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
      console.debug('loadAndRenderPaths: rendered', layers.length, 'path layers');
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

    // Initialize editor lists if not already done
    if (!editorState.initialized) {
      initEditorLists();
      editorState.initialized = true;
    }

    // Load editor lists
    try {
      loadRegionsList();
      loadPathsList();
      loadWallsList();
    } catch (e) { console.error('build-path:showPanel load lists', e); }

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

      // clear draggable markers
      clearEditMarkers();

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

    // Initialize editor features
    initEditorTabs();
    initEditorForm();

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

  // Editor state
  let editorState = {
    currentTab: 'regions',
    editingItem: null,
    editingType: null,
    regions: [],
    paths: [],
    walls: [],
    initialized: false
  };

  // Tab switching
  function initEditorTabs() {
    const tabs = ['regions', 'paths', 'walls'];
    tabs.forEach(tab => {
      const btn = document.getElementById(`tab-${tab}`);
      if (!btn) return;
      btn.addEventListener('click', () => {
        tabs.forEach(t => {
          const b = document.getElementById(`tab-${t}`);
          const c = document.getElementById(`${t}-list-container`);
          if (b && c) {
            if (t === tab) {
              b.classList.add('active');
              b.style.background = '#333';
              b.style.color = '#fff';
              c.style.display = 'block';
            } else {
              b.classList.remove('active');
              b.style.background = '#222';
              b.style.color = '#aaa';
              c.style.display = 'none';
            }
          }
        });
        editorState.currentTab = tab;
      });
    });
  }

  // Load and render lists
  async function initEditorLists() {
    // Load initial data
    await Promise.all([
      loadRegionsList(),
      loadPathsList(),
      loadWallsList()
    ]);

    // Wire new buttons
    const btnNewRegion = document.getElementById('btn-new-region');
    const btnNewPath = document.getElementById('btn-new-path');
    const btnNewWall = document.getElementById('btn-new-wall');

    if (btnNewRegion) btnNewRegion.addEventListener('click', () => createNewItem('region'));
    if (btnNewPath) btnNewPath.addEventListener('click', () => createNewItem('path'));
    if (btnNewWall) btnNewWall.addEventListener('click', () => createNewItem('wall'));
  }

  async function loadRegionsList() {
    try {
      const socket = window.getSocket && window.getSocket();
      if (!socket || !socket.connected) {
        console.error('WebSocket not connected');
        return;
      }
      
      socket.emit('editor:regions:get', (response) => {
        if (response.success) {
          editorState.regions = response.data;
          renderRegionsList();
        } else {
          console.error('Failed to load regions:', response.error);
        }
      });
    } catch (error) {
      console.error('Failed to load regions:', error);
    }
  }

  async function loadPathsList() {
    try {
      const socket = window.getSocket && window.getSocket();
      if (!socket || !socket.connected) {
        console.error('WebSocket not connected');
        return;
      }
      
      socket.emit('editor:paths:get', (response) => {
        if (response.success) {
          editorState.paths = response.data;
          renderPathsList();
        } else {
          console.error('Failed to load paths:', response.error);
        }
      });
    } catch (error) {
      console.error('Failed to load paths:', error);
    }
  }

  async function loadWallsList() {
    try {
      const socket = window.getSocket && window.getSocket();
      if (!socket || !socket.connected) {
        console.error('WebSocket not connected');
        return;
      }
      
      socket.emit('editor:walls:get', (response) => {
        if (response.success) {
          editorState.walls = response.data;
          renderWallsList();
        } else {
          console.error('Failed to load walls:', response.error);
        }
      });
    } catch (error) {
      console.error('Failed to load walls:', error);
    }
  }

  function renderRegionsList() {
    const container = document.getElementById('regions-list');
    if (!container) return;
    
    container.innerHTML = editorState.regions.map(region => `
      <div class="list-item" data-id="${region.id}" style="padding:4px 6px;margin:2px 0;background:#222;border:1px solid #333;cursor:pointer;color:#e0e0e0;font-size:11px;" onmouseover="this.style.background='#333'" onmouseout="this.style.background='#222'">
        <strong>${region.name}</strong><br>
        <small style="color:#999;">ID: ${region.id} | Type: ${region.type || 'N/A'} | Owner: ${region.owner || 'N/A'}</small>
      </div>
    `).join('');

    // Wire click handlers
    container.querySelectorAll('.list-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.getAttribute('data-id');
        const region = editorState.regions.find(r => r.id === id);
        if (region) editItem('region', region);
      });
    });
  }

  function renderPathsList() {
    const container = document.getElementById('paths-list');
    if (!container) return;
    
    container.innerHTML = editorState.paths.map(path => `
      <div class="list-item" data-id="${path.id}" style="padding:4px 6px;margin:2px 0;background:#222;border:1px solid #333;cursor:pointer;color:#e0e0e0;font-size:11px;" onmouseover="this.style.background='#333'" onmouseout="this.style.background='#222'">
        <strong>${path.name}</strong><br>
        <small style="color:#999;">ID: ${path.id} | Points: ${(path.positions || []).length} | Loop: ${path.loop ? 'Yes' : 'No'}</small>
      </div>
    `).join('');

    container.querySelectorAll('.list-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.getAttribute('data-id');
        const path = editorState.paths.find(p => p.id === id);
        if (path) editItem('path', path);
      });
    });
  }

  function renderWallsList() {
    const container = document.getElementById('walls-list');
    if (!container) return;
    
    container.innerHTML = editorState.walls.map(wall => `
      <div class="list-item" data-id="${wall.id}" style="padding:4px 6px;margin:2px 0;background:#222;border:1px solid #333;cursor:pointer;color:#e0e0e0;font-size:11px;" onmouseover="this.style.background='#333'" onmouseout="this.style.background='#222'">
        <strong>${wall.name}</strong><br>
        <small style="color:#999;">ID: ${wall.id} | Points: ${(wall.positions || []).length}</small>
      </div>
    `).join('');

    container.querySelectorAll('.list-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.getAttribute('data-id');
        const wall = editorState.walls.find(w => w.id === id);
        if (wall) editItem('wall', wall);
      });
    });
  }

  function createNewItem(type) {
    const newItem = {
      id: '',
      name: '',
      positions: type === 'region' ? [] : []
    };

    if (type === 'region') {
      newItem.type = 'safe';
      newItem.owner = 'neutral';
      newItem.walkable = true;
      newItem.coordinates = [];
      newItem.music = '';
      // When creating a new region, ensure build mode is area so it renders as a polygon
      try {
        gameState.buildMode = 'area';
        const modeSelect = document.getElementById('build-path-mode');
        if (modeSelect) modeSelect.value = 'area';
        updateBuildPathPolyline();
      } catch (e) { /* ignore if DOM not ready */ }
    } else if (type === 'path') {
      newItem.loop = false;
    }

    editItem(type, newItem, true);
  }

  // Draggable markers for editing
  let editMarkers = [];

  function clearEditMarkers() {
    editMarkers.forEach(marker => {
      try { map.removeLayer(marker); } catch (e) {}
    });
    editMarkers = [];
  }

  // Interpolate points to maintain ~20px distance
  function interpolatePoints(points, targetDistance = 20) {
    if (points.length < 2) return points;
    
    const result = [];
    
    for (let i = 0; i < points.length - 1; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[i + 1];
      
      result.push([x1, y1]);
      
      const dx = x2 - x1;
      const dy = y2 - y1;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance > targetDistance) {
        const steps = Math.floor(distance / targetDistance);
        for (let j = 1; j < steps; j++) {
          const t = j / steps;
          const ix = Math.round(x1 + dx * t);
          const iy = Math.round(y1 + dy * t);
          result.push([ix, iy]);
        }
      }
    }
    
    // Add the last point
    result.push(points[points.length - 1]);
    
    return result;
  }

  function createEditMarkers(points) {
    clearEditMarkers();
    
    points.forEach((point, index) => {
      const [x, y] = point;
      const latlng = [totalH - y, x];
      
      // Create a custom icon for the marker
      const customIcon = L.divIcon({
        className: 'edit-point-marker',
        html: `<div style="width:12px;height:12px;border-radius:50%;background:#ff6600;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.5);cursor:move;"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      });
      
      const marker = L.marker(latlng, {
        icon: customIcon,
        draggable: true
      }).addTo(map);

      // Store the index so we can update the right point
      marker.pointIndex = index;

      // Handle drag start - remove nearby interpolated points
      marker.on('dragstart', function(e) {
        const removeRadius = 50; // Remove points within this radius of the dragged point
        const [dragX, dragY] = gameState.buildPathPoints[this.pointIndex];
        
        // Filter out points that are too close to the dragged point (except endpoints and the dragged point itself)
        const filtered = [];
        for (let i = 0; i < gameState.buildPathPoints.length; i++) {
          const [x, y] = gameState.buildPathPoints[i];
          const dist = Math.sqrt((x - dragX) ** 2 + (y - dragY) ** 2);
          
          // Keep if: it's an endpoint, it's the dragged point, or it's far enough away
          if (i === 0 || 
              i === gameState.buildPathPoints.length - 1 || 
              i === this.pointIndex || 
              dist > removeRadius) {
            filtered.push(gameState.buildPathPoints[i]);
            
            // Update the index if this is the dragged point
            if (i === this.pointIndex) {
              this.pointIndex = filtered.length - 1;
            }
          }
        }
        
        gameState.buildPathPoints = filtered;
        updateBuildPathPolyline();
      });

      // Handle drag events
      marker.on('drag', function(e) {
        const newLatLng = e.target.getLatLng();
        const newX = Math.round(newLatLng.lng);
        const newY = Math.round(totalH - newLatLng.lat);
        
        // Update the point in buildPathPoints
        gameState.buildPathPoints[this.pointIndex] = [newX, newY];
        
        // Update the polyline visualization (without interpolation during drag for performance)
        updateBuildPathPolyline();
      });

      marker.on('dragend', function(e) {
        const newLatLng = e.target.getLatLng();
        const newX = Math.round(newLatLng.lng);
        const newY = Math.round(totalH - newLatLng.lat);
        
        // Final update
        gameState.buildPathPoints[this.pointIndex] = [newX, newY];
        
        // Apply interpolation after drag ends
        const interpolated = interpolatePoints(gameState.buildPathPoints, 20);
        gameState.buildPathPoints = interpolated;
        
        // Update textarea with interpolated points
        const ta = document.getElementById('build-path-textarea');
        if (ta) {
          ta.value = formatPointsToTextarea(gameState.buildPathPoints);
        }
        
        // Recreate all markers with new interpolated points
        clearEditMarkers();
        
        // Recreate markers for all points
        gameState.buildPathPoints.forEach((point, idx) => {
          const [px, py] = point;
          const platlng = [totalH - py, px];
          
          const pIcon = L.divIcon({
            className: 'edit-point-marker',
            html: `<div style="width:12px;height:12px;border-radius:50%;background:#ff6600;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.5);cursor:move;"></div>`,
            iconSize: [16, 16],
            iconAnchor: [8, 8]
          });
          
          const pMarker = L.marker(platlng, {
            icon: pIcon,
            draggable: true
          }).addTo(map);
          
          pMarker.pointIndex = idx;
          
          // Re-attach drag handlers
          pMarker.on('drag', function(ev) {
            const nl = ev.target.getLatLng();
            const nx = Math.round(nl.lng);
            const ny = Math.round(totalH - nl.lat);
            gameState.buildPathPoints[this.pointIndex] = [nx, ny];
            updateBuildPathPolyline();
          });
          
          pMarker.on('dragend', arguments.callee);
          
          // Right-click to remove point
          pMarker.on('contextmenu', function(ev) {
            L.DomEvent.stopPropagation(ev);
            L.DomEvent.preventDefault(ev);
            
            if (gameState.buildPathPoints.length <= 2) {
              alert('Cannot remove point - at least 2 points are required');
              return;
            }
            
            // Remove the point
            gameState.buildPathPoints.splice(this.pointIndex, 1);
            
            // Update textarea
            const ta = document.getElementById('build-path-textarea');
            if (ta) {
              ta.value = formatPointsToTextarea(gameState.buildPathPoints);
            }
            
            // Recreate markers
            clearEditMarkers();
            createEditMarkers(gameState.buildPathPoints);
            
            // Update polyline
            updateBuildPathPolyline();
          });
          
          pMarker.bindTooltip(`Point ${idx + 1}: [${px}, ${py}]`, {
            permanent: false,
            direction: 'top',
            offset: [0, -10]
          });
          
          editMarkers.push(pMarker);
        });
        
        // Update the polyline visualization
        updateBuildPathPolyline();
      });

      // Right-click to remove point
      marker.on('contextmenu', function(e) {
        L.DomEvent.stopPropagation(e);
        L.DomEvent.preventDefault(e);
        
        if (gameState.buildPathPoints.length <= 2) {
          alert('Cannot remove point - at least 2 points are required');
          return;
        }
        
        // Remove the point
        gameState.buildPathPoints.splice(this.pointIndex, 1);
        
        // Update textarea
        const ta = document.getElementById('build-path-textarea');
        if (ta) {
          ta.value = formatPointsToTextarea(gameState.buildPathPoints);
        }
        
        // Recreate markers
        clearEditMarkers();
        createEditMarkers(gameState.buildPathPoints);
        
        // Update polyline
        updateBuildPathPolyline();
      });

      // Add tooltip showing point index and coordinates
      marker.bindTooltip(`Point ${index + 1}: [${x}, ${y}]`, {
        permanent: false,
        direction: 'top',
        offset: [0, -10]
      });

      editMarkers.push(marker);
    });
  }

  function editItem(type, item, isNew = false) {
    editorState.editingItem = { ...item };
    editorState.editingType = type;
    editorState.isNew = isNew;

    const form = document.getElementById('editor-form');
    const regionFields = document.getElementById('region-fields');
    const pathFields = document.getElementById('path-fields');
    const ta = document.getElementById('build-path-textarea');

    if (!form) return;

    // Show form
    form.style.display = 'block';

    // Populate basic fields
    const idInput = document.getElementById('edit-id');
    const nameInput = document.getElementById('edit-name');
    if (idInput) {
      idInput.value = item.id || '';
      idInput.disabled = !isNew;
    }
    if (nameInput) nameInput.value = item.name || '';

    // Show/hide type-specific fields
    if (regionFields) regionFields.style.display = type === 'region' ? 'block' : 'none';
    if (pathFields) pathFields.style.display = type === 'path' ? 'block' : 'none';

    // Populate type-specific fields
    if (type === 'region') {
      const typeSelect = document.getElementById('edit-type');
      const ownerSelect = document.getElementById('edit-owner');
      const walkableCheck = document.getElementById('edit-walkable');
      const musicInput = document.getElementById('edit-music');
      if (typeSelect) typeSelect.value = item.type || 'safe';
      if (ownerSelect) ownerSelect.value = item.owner || 'neutral';
      if (walkableCheck) walkableCheck.checked = item.walkable !== false;
      if (musicInput) musicInput.value = item.music || item.musicFile || item.music_file || '';

      // Show coordinates in textarea
      if (ta && item.coordinates) {
        ta.value = formatPointsToTextarea(item.coordinates);
        gameState.buildPathPoints = [...item.coordinates];
        // Ensure build mode is area when editing a region so it renders as a polygon
        try {
          gameState.buildMode = 'area';
          const modeSelect = document.getElementById('build-path-mode');
          if (modeSelect) modeSelect.value = 'area';
        } catch (e) {}
        updateBuildPathPolyline();
        // Create draggable markers for editing
        if (item.coordinates.length > 0) {
          createEditMarkers(item.coordinates);
        }
      }
    } else {
      // paths and walls use positions
      if (ta && item.positions) {
        ta.value = formatPointsToTextarea(item.positions);
        gameState.buildPathPoints = [...item.positions];
        updateBuildPathPolyline();
        // Create draggable markers for editing
        if (item.positions.length > 0) {
          createEditMarkers(item.positions);
        }
      }

      if (type === 'path') {
        const loopCheck = document.getElementById('edit-loop');
        if (loopCheck) loopCheck.checked = item.loop === true;
      }
    }
  }

  function initEditorForm() {
    const btnSave = document.getElementById('btn-save');
    const btnCancel = document.getElementById('btn-cancel');
    const btnDelete = document.getElementById('btn-delete');

    if (btnSave) btnSave.addEventListener('click', saveItem);
    if (btnCancel) btnCancel.addEventListener('click', cancelEdit);
    if (btnDelete) btnDelete.addEventListener('click', deleteItem);
  }

  async function saveItem() {
    const { editingItem, editingType, isNew } = editorState;
    if (!editingItem || !editingType) return;

    // Gather form data
    const id = document.getElementById('edit-id')?.value || '';
    const name = document.getElementById('edit-name')?.value || '';
    const ta = document.getElementById('build-path-textarea');
    const positions = ta ? parseTextareaToPoints(ta) : [];

    if (!id || !name) {
      alert('ID and Name are required');
      return;
    }

    const item = { id, name };

    // Preserve existing properties (like fillColor) if present on the editing item
    try {
      const existing = editorState && editorState.editingItem ? editorState.editingItem : null;
      if (existing && existing.properties) {
        // shallow copy to avoid mutation
        item.properties = JSON.parse(JSON.stringify(existing.properties));
      } else {
        item.properties = item.properties || {};
      }
    } catch (e) {
      item.properties = item.properties || {};
    }

    if (editingType === 'region') {
      item.type = document.getElementById('edit-type')?.value || 'safe';
      item.owner = document.getElementById('edit-owner')?.value || 'neutral';
      item.walkable = document.getElementById('edit-walkable')?.checked !== false;
      item.music = document.getElementById('edit-music')?.value || '';
      item.coordinates = positions;
    } else {
      item.positions = positions;
      if (editingType === 'path') {
        item.loop = document.getElementById('edit-loop')?.checked === true;
      }
    }

    try {
      const socket = window.getSocket && window.getSocket();
      if (!socket || !socket.connected) {
        throw new Error('WebSocket not connected');
      }

      const eventName = `editor:${editingType}:save`;
      
      socket.emit(eventName, { item, isNew }, (response) => {
        if (response.success) {
          // Reload the appropriate list
          if (editingType === 'region') loadRegionsList();
          else if (editingType === 'path') loadPathsList();
          else if (editingType === 'wall') loadWallsList();

          // Reload rendered layers if they're visible
          if (gameState.showRegions && typeof loadAndRenderRegions === 'function') loadAndRenderRegions();
          if (gameState.showPaths && typeof loadAndRenderPaths === 'function') loadAndRenderPaths();

          cancelEdit();
          alert(`${editingType.charAt(0).toUpperCase() + editingType.slice(1)} saved successfully!`);
        } else {
          throw new Error(response.error || 'Failed to save');
        }
      });
    } catch (error) {
      console.error('Failed to save:', error);
      alert('Failed to save: ' + error.message);
    }
  }

  function cancelEdit() {
    editorState.editingItem = null;
    editorState.editingType = null;
    editorState.isNew = false;

    const form = document.getElementById('editor-form');
    const ta = document.getElementById('build-path-textarea');

    if (form) form.style.display = 'none';
    if (ta) ta.value = '';

    gameState.buildPathPoints = [];
    if (gameState.buildPathPolyline) {
      try { map.removeLayer(gameState.buildPathPolyline); } catch(e){}
      gameState.buildPathPolyline = null;
    }
    
    // Clear draggable markers
    clearEditMarkers();
  }

  async function deleteItem() {
    const { editingItem, editingType } = editorState;
    if (!editingItem || !editingType || !editingItem.id) return;

    if (!confirm(`Are you sure you want to delete this ${editingType}?`)) return;

    try {
      const socket = window.getSocket && window.getSocket();
      if (!socket || !socket.connected) {
        throw new Error('WebSocket not connected');
      }

      const eventName = `editor:${editingType}:delete`;
      
      socket.emit(eventName, { id: editingItem.id }, (response) => {
        if (response.success) {
          // Reload the appropriate list
          if (editingType === 'region') loadRegionsList();
          else if (editingType === 'path') loadPathsList();
          else if (editingType === 'wall') loadWallsList();

          // Reload rendered layers if they're visible
          if (gameState.showRegions && typeof loadAndRenderRegions === 'function') loadAndRenderRegions();
          if (gameState.showPaths && typeof loadAndRenderPaths === 'function') loadAndRenderPaths();

          cancelEdit();
          alert(`${editingType.charAt(0).toUpperCase() + editingType.slice(1)} deleted successfully!`);
        } else {
          throw new Error(response.error || 'Failed to delete');
        }
      });
    } catch (error) {
      console.error('Failed to delete:', error);
      alert('Failed to delete: ' + error.message);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
