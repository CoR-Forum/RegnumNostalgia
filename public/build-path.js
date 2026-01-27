(function(){
  // Build Path module - creates panel, handles clicks and polyline drawing
  const tpl = `
  <div id="build-path-panel" style="position: absolute; right: 12px; bottom: 140px; width: 360px; background: #1a1a1a; border: 1px solid #333; box-shadow: 0 4px 16px rgba(0,0,0,0.8); z-index: 1000; display: none; flex-direction: column; font-family: 'MS Sans Serif', Arial, sans-serif;">
    <div id="build-path-header" style="padding: 3px 4px; background: linear-gradient(180deg, #000080 0%, #1084d0 100%); cursor: move; display: flex; justify-content: space-between; align-items: center; user-select: none;">
      <h2 style="margin: 0; flex: 1; font-size: 11px; font-weight: 700; color: #ffffff;">Build Path</h2>
      <div style="display:flex;gap:6px;align-items:center">
        <button id="build-path-clear" class="btn" style="width:auto;padding:4px 8px;">Clear</button>
        <button id="build-path-copy" class="btn" style="width:auto;padding:4px 8px;">Copy</button>
        <button id="build-path-close" class="btn" style="width:auto;padding:4px 8px;">Close</button>
      </div>
    </div>
    <div style="padding:8px">
      <p style="color:#e0e0e0;font-size:11px;margin-bottom:8px;">Click on the map to append coordinates to the textarea below.</p>
      <textarea id="build-path-textarea" rows="10" style="width:100%;background:#111;border:1px solid #222;color:#e0e0e0;padding:8px;font-family: monospace;"></textarea>
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
    const lines = ta.value.split('\n');
    for (const ln of lines) {
      const m = ln.match(/\[\s*(\d+)\s*,\s*(\d+)\s*\]/);
      if (m) pts.push([parseInt(m[1],10), parseInt(m[2],10)]);
    }
    return pts;
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
      gameState.buildPathPolyline = L.polyline(pts, { color: '#ffff00', weight: 3, opacity: 0.9, dashArray: '6,6' }).addTo(map);
      try { gameState.buildPathPolyline.bringToFront(); } catch(e){}
    } catch (e) { console.error('build-path:updateBuildPathPolyline', e); }
  }

  function onMapClick(e) {
    try {
      const panel = document.getElementById('build-path-panel');
      if (!panel || panel.style.display === 'none') return;
      const x = Math.round(e.latlng.lng);
      const y = Math.round(totalH - e.latlng.lat);
      const ta = document.getElementById('build-path-textarea');
      if (ta) {
        if (ta.value && ta.value.trim().length > 0 && !ta.value.endsWith('\n')) ta.value += '\n';
        ta.value += `  [${x}, ${y}],\n`;
        ta.scrollTop = ta.scrollHeight;
      }
      gameState.buildPathPoints = gameState.buildPathPoints || [];
      gameState.buildPathPoints.push([x,y]);
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
  }

  function init() {
    const panel = ensurePanel();
    const header = document.getElementById('build-path-header');
    const clearBtn = document.getElementById('build-path-clear');
    const closeBtn = document.getElementById('build-path-close');
    const copyBtn = document.getElementById('build-path-copy');
    const ta = document.getElementById('build-path-textarea');

    wireDrag(header, panel);

    if (clearBtn) clearBtn.addEventListener('click', () => {
      if (ta) ta.value = '';
      gameState.buildPathPoints = [];
      if (gameState.buildPathPolyline) { try { map.removeLayer(gameState.buildPathPolyline); } catch(e){} gameState.buildPathPolyline = null; }
    });

    if (closeBtn) closeBtn.addEventListener('click', () => { hidePanel(); if (gameState.buildPathPolyline) { try { map.removeLayer(gameState.buildPathPolyline); } catch(e){} gameState.buildPathPolyline = null; } });

    if (copyBtn) copyBtn.addEventListener('click', async () => {
      try {
        if (!ta) return;
        if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(ta.value);
        else { const tmp = document.createElement('textarea'); tmp.value = ta.value; document.body.appendChild(tmp); tmp.select(); document.execCommand('copy'); document.body.removeChild(tmp); }
      } catch (e) { console.error('build-path:copy', e); }
    });

    // expose public API
    window.buildPath = {
      init,
      showPanel,
      hidePanel,
      onMapClick,
      updateBuildPathPolyline
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
