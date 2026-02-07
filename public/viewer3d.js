/**
 * 3D Street View Viewer for Regnum Nostalgia
 * Opens when the user zooms fully into the 2D map.
 * Renders the game world in first-person using Three.js.
 *
 * Features:
 *  - Ground plane textured with the same map tiles
 *  - Paths drawn as colored tubes above the terrain
 *  - Screenshots displayed as billboard panels in the world
 *  - First-person (Google Street View–like) navigation
 *  - Server-authoritative movement with client-side prediction
 */
(function () {
  'use strict';

  /* ─── constants ─── */
  const WORLD_SIZE = 6144;
  const CAMERA_HEIGHT = 10;
  const LOOK_SPEED = 0.003;
  const PATH_HEIGHT = 4;           // paths hover slightly above ground
  const SCREENSHOT_HEIGHT = 150;   // billboard center height
  const SCREENSHOT_WIDTH = 200;    // max billboard width
  const FOG_DENSITY = 0.00025;
  const SKY_COLOR = 0x7ec8e3;
  const GROUND_COLOR = 0x4a7c3f;
  const DEFAULT_FOV = 75;
  const MIN_FOV = 20;
  const MAX_FOV = 110;
  const ZOOM_STEP = 3;             // FOV degrees per scroll tick

  /* ── Prediction constants (must match server) ── */
  const SV_MOVE_SPEED = 20;        // world-units per server tick (matches STEP_SIZE / server MOVE3D_SPEED)
  const SV_SPRINT_MUL = 3;
  const INPUT_TICK_MS = 100;       // send input to server every 100ms

  /* ─── module state ─── */
  let container, renderer, scene, camera;
  let isActive = false;
  let animationId = null;
  let clock;
  let initialized = false;

  // Objects we add dynamically so we can clear them on re-enter
  let dynamicObjects = [];

  // Input
  const keys = {};
  let isMouseDown = false;
  let prevMouseX = 0, prevMouseY = 0;
  let cameraYaw = 0, cameraPitch = 0;

  /* ── Networking / prediction state ── */
  let inputSeq = 0;                 // monotonically increasing input ID
  let pendingInputs = [];           // inputs sent but not yet acknowledged
  let serverPos = { x: 0, y: 0 };  // last authoritative position
  let inputTickTimer = null;        // setInterval handle
  let socket = null;                // reference to the game socket

  /* ── Smooth interpolation state ── */
  let visualPos = { x: 0, y: 0 };  // where the camera actually is (smoothed)
  const LERP_FACTOR = 12;           // how fast visual catches up (units/sec multiplier)

  /* ── Client-side walkability check (mirrors server logic) ── */
  function pointInPolygon(px, py, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0], yi = polygon[i][1];
      const xj = polygon[j][0], yj = polygon[j][1];
      const intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function isPositionWalkable(x, y) {
    if (x < 0 || x > WORLD_SIZE || y < 0 || y > WORLD_SIZE) return false;
    const gs = window.gameState || {};
    const regions = gs.regionsData || [];
    if (regions.length === 0) return true; // no data yet, allow
    const realm = gs.realm || '';
    for (const r of regions) {
      const poly = r.coordinates || r.positions || [];
      if (poly.length === 0) continue;
      if (pointInPolygon(x, y, poly)) {
        if (r.type === 'warzone') return true;
        const walkable = r.walkable !== undefined ? !!r.walkable : true;
        const ownerMatches = (r.owner == null) || (String(r.owner) === String(realm));
        return walkable && ownerMatches;
      }
    }
    // No region matched → water
    return false;
  }

  /* ================================================================
   *  INITIALIZATION
   * ================================================================ */

  function init() {
    container = document.getElementById('viewer3d-container');
    if (!container) return;

    // ── Scene ──
    scene = new THREE.Scene();
    scene.background = new THREE.Color(SKY_COLOR);
    scene.fog = new THREE.FogExp2(SKY_COLOR, FOG_DENSITY);

    // ── Camera ──
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1, 12000);

    // ── Renderer ──
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.querySelector('#viewer3d-canvas-wrap').appendChild(renderer.domElement);

    // ── Lighting ──
    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const sun = new THREE.DirectionalLight(0xfff4e0, 0.85);
    sun.position.set(2000, 3000, -1000);
    scene.add(sun);

    // ── Sky hemisphere ──
    const hemi = new THREE.HemisphereLight(0x88ccff, 0x446633, 0.4);
    scene.add(hemi);

    // ── Clock ──
    clock = new THREE.Clock(false);

    // ── Ground ──
    createGround();

    // ── Grid helper (subtle) ──
    const grid = new THREE.GridHelper(WORLD_SIZE, 60, 0x556644, 0x445533);
    grid.position.set(WORLD_SIZE / 2, 0.5, WORLD_SIZE / 2);
    grid.material.opacity = 0.15;
    grid.material.transparent = true;
    scene.add(grid);

    // ── Controls (keyboard only – mouse hooks are added on enter) ──
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    window.addEventListener('resize', onResize);

    initialized = true;
  }

  /* ================================================================
   *  GROUND  (3×3 tile grid)
   * ================================================================ */

  function createGround() {
    const tileVersion = localStorage.getItem('tileVersion') || 'v1';
    const tileSize = WORLD_SIZE / 3;
    const loader = new THREE.TextureLoader();

    for (let r = 1; r <= 3; r++) {
      for (let c = 1; c <= 3; c++) {
        // Use local tile assets so WebGL doesn't hit CORS restrictions
        const url = `assets/tiles-${tileVersion}/${r}-${c}.png`;

        // Geometry: plane in XZ, facing up (+Y)
        const geo = new THREE.PlaneGeometry(tileSize, tileSize);
        geo.rotateX(-Math.PI / 2);

        const mat = new THREE.MeshLambertMaterial({
          color: GROUND_COLOR,
          side: THREE.FrontSide
        });

        const mesh = new THREE.Mesh(geo, mat);
        const cx = (c - 1) * tileSize + tileSize / 2;
        const cz = (r - 1) * tileSize + tileSize / 2;
        mesh.position.set(cx, 0, cz);
        scene.add(mesh);

        // Async texture load
        loader.load(url, (tex) => {
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.colorSpace = THREE.SRGBColorSpace;
          mat.map = tex;
          mat.color.setHex(0xffffff);
          mat.needsUpdate = true;
        }, undefined, () => {
          console.warn('[3D] Could not load tile texture:', url);
        });
      }
    }
  }

  /* ================================================================
   *  PATHS
   * ================================================================ */

  function drawPaths(paths) {
    if (!paths || paths.length === 0) return;

    paths.forEach((path) => {
      const pts = path.positions || [];
      if (pts.length < 2) return;

      const vectors = pts.map((p) => new THREE.Vector3(p[0], PATH_HEIGHT, p[1]));
      const color = path.loop ? 0xff00ff : 0x3399ff;

      try {
        const curve = new THREE.CatmullRomCurve3(vectors, !!path.loop);
        const tubeGeo = new THREE.TubeGeometry(curve, Math.max(pts.length * 3, 64), 3.5, 8, !!path.loop);
        const tubeMat = new THREE.MeshPhongMaterial({
          color,
          transparent: true,
          opacity: 0.7,
          emissive: new THREE.Color(color),
          emissiveIntensity: 0.15
        });
        const tube = new THREE.Mesh(tubeGeo, tubeMat);
        scene.add(tube);
        dynamicObjects.push(tube);
      } catch (e) {
        const lineGeo = new THREE.BufferGeometry().setFromPoints(vectors);
        const lineMat = new THREE.LineBasicMaterial({ color, linewidth: 2 });
        const line = new THREE.Line(lineGeo, lineMat);
        scene.add(line);
        dynamicObjects.push(line);
      }
    });
  }

  /* ================================================================
   *  SCREENSHOTS  (billboard panels)
   * ================================================================ */

  function placeScreenshots(screenshots) {
    if (!screenshots || screenshots.length === 0) return;

    const loader = new THREE.TextureLoader();
    loader.crossOrigin = 'anonymous';

    screenshots.forEach((s) => {
      if (s.x == null || s.y == null || !s.filename) return;

      const wx = s.x;
      const wz = s.y;

      // Pole
      const poleH = SCREENSHOT_HEIGHT;
      const poleGeo = new THREE.CylinderGeometry(1.2, 1.2, poleH, 6);
      const poleMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(wx, poleH / 2, wz);
      scene.add(pole);
      dynamicObjects.push(pole);

      // Billboard frame
      const frameGeo = new THREE.PlaneGeometry(SCREENSHOT_WIDTH, SCREENSHOT_WIDTH * 0.6);
      const frameMat = new THREE.MeshBasicMaterial({
        color: 0x222222,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85
      });
      const frame = new THREE.Mesh(frameGeo, frameMat);
      frame.position.set(wx, SCREENSHOT_HEIGHT, wz);
      scene.add(frame);
      dynamicObjects.push(frame);

      // Screenshot texture
      const imgUrl = `https://cor-forum.de/regnum/RegnumNostalgia/screenshots/${s.filename}`;
      loader.load(imgUrl, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        const aspect = tex.image.width / tex.image.height;
        let w = SCREENSHOT_WIDTH;
        let h = w / aspect;
        if (h > SCREENSHOT_WIDTH) { h = SCREENSHOT_WIDTH; w = h * aspect; }
        frame.geometry.dispose();
        frame.geometry = new THREE.PlaneGeometry(w, h);
        frameMat.map = tex;
        frameMat.color.setHex(0xffffff);
        frameMat.opacity = 1;
        frameMat.needsUpdate = true;
      }, undefined, () => {
        console.warn('[3D] Could not load screenshot:', imgUrl);
      });

      // Label sprite
      const label = s.nameEn || s.nameDe || s.nameEs || s.location || 'Screenshot';
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      roundRect(ctx, 0, 0, 512, 64, 12);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 30px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(truncate(label, 36), 256, 32);

      const labelTex = new THREE.CanvasTexture(canvas);
      const spriteMat = new THREE.SpriteMaterial({ map: labelTex, transparent: true, depthTest: false });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.set(wx, SCREENSHOT_HEIGHT + SCREENSHOT_WIDTH * 0.35, wz);
      sprite.scale.set(220, 28, 1);
      scene.add(sprite);
      dynamicObjects.push(sprite);

      // Ground dot
      const dotGeo = new THREE.SphereGeometry(5, 8, 8);
      const dotMat = new THREE.MeshBasicMaterial({ color: 0xff6644 });
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.set(wx, 3, wz);
      scene.add(dot);
      dynamicObjects.push(dot);
    });
  }

  function truncate(str, max) {
    return str.length > max ? str.slice(0, max - 1) + '…' : str;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /* ================================================================
   *  BILLBOARD FACING
   * ================================================================ */

  function updateBillboards() {
    dynamicObjects.forEach((obj) => {
      if (obj.isMesh && obj.geometry && obj.geometry.type === 'PlaneGeometry' && obj.material && obj.material.map) {
        const dx = camera.position.x - obj.position.x;
        const dz = camera.position.z - obj.position.z;
        obj.rotation.y = Math.atan2(dx, dz);
      }
    });
  }

  /* ================================================================
   *  CONTROLS
   * ================================================================ */

  function onKeyDown(e) {
    if (!isActive) return;
    keys[e.code] = true;
    if (e.code === 'Escape') exit3DView();
  }

  function onKeyUp(e) {
    keys[e.code] = false;
  }

  function onMouseDown(e) {
    if (!isActive) return;
    isMouseDown = true;
    prevMouseX = e.clientX;
    prevMouseY = e.clientY;
    container.style.cursor = 'grabbing';
  }

  function onMouseMove(e) {
    if (!isActive || !isMouseDown) return;
    const dx = e.clientX - prevMouseX;
    const dy = e.clientY - prevMouseY;
    prevMouseX = e.clientX;
    prevMouseY = e.clientY;

    cameraYaw -= dx * LOOK_SPEED;
    cameraPitch -= dy * LOOK_SPEED;
    cameraPitch = Math.max(-1.5, Math.min(1.5, cameraPitch));

    applyCameraRotation();
  }

  function onMouseUp() {
    isMouseDown = false;
    if (container) container.style.cursor = 'grab';
  }

  function onWheel(e) {
    if (!isActive) return;
    e.preventDefault();
    const dir = Math.sign(e.deltaY);
    camera.fov = Math.max(MIN_FOV, Math.min(MAX_FOV, camera.fov + dir * ZOOM_STEP));
    camera.updateProjectionMatrix();
  }

  function onTouchStart(e) {
    if (!isActive || e.touches.length === 0) return;
    isMouseDown = true;
    prevMouseX = e.touches[0].clientX;
    prevMouseY = e.touches[0].clientY;
  }

  function onTouchMove(e) {
    if (!isActive || !isMouseDown || e.touches.length === 0) return;
    e.preventDefault();
    const dx = e.touches[0].clientX - prevMouseX;
    const dy = e.touches[0].clientY - prevMouseY;
    prevMouseX = e.touches[0].clientX;
    prevMouseY = e.touches[0].clientY;
    cameraYaw -= dx * LOOK_SPEED;
    cameraPitch -= dy * LOOK_SPEED;
    cameraPitch = Math.max(-1.5, Math.min(1.5, cameraPitch));
    applyCameraRotation();
  }

  function onTouchEnd() {
    isMouseDown = false;
  }

  function applyCameraRotation() {
    const euler = new THREE.Euler(cameraPitch, cameraYaw, 0, 'YXZ');
    camera.quaternion.setFromEuler(euler);
  }

  /* ================================================================
   *  SERVER-AUTHORITATIVE MOVEMENT WITH CLIENT-SIDE PREDICTION
   *
   *  Flow:
   *  1. Every INPUT_TICK_MS, sample keys → build input {seq, dx, dz, sprint, yaw}
   *  2. Apply the same movement locally (prediction)
   *  3. Send input to server via WebSocket
   *  4. Store input in pendingInputs
   *  5. On server ack (move3d:state), snap to server position,
   *     then re-apply any inputs the server hasn't seen yet
   * ================================================================ */

  /** Build a raw direction vector from current key state (view-local, un-rotated) */
  function sampleInput() {
    let dx = 0, dz = 0;
    if (keys['KeyW'] || keys['ArrowUp'])    dz -= 1;
    if (keys['KeyS'] || keys['ArrowDown'])  dz += 1;
    if (keys['KeyA'] || keys['ArrowLeft'])  dx -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) dx += 1;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len > 0) { dx /= len; dz /= len; }
    const sprint = !!(keys['ShiftLeft'] || keys['ShiftRight']);
    return { dx, dz, sprint };
  }

  /**
   * Apply one input deterministically and return the new position.
   * This is the SHARED simulation step — must match the server exactly.
   * pos: {x, y}   input: {dx, dz, sprint, yaw}
   */
  function applyInput(pos, input) {
    const speed = SV_MOVE_SPEED * (input.sprint ? SV_SPRINT_MUL : 1);
    const cosY = Math.cos(input.yaw);
    const sinY = Math.sin(input.yaw);
    const worldDx = input.dx * cosY + input.dz * sinY;
    const worldDz = -input.dx * sinY + input.dz * cosY;
    let nx = pos.x + worldDx * speed;
    let ny = pos.y + worldDz * speed;
    nx = Math.max(0, Math.min(WORLD_SIZE, Math.round(nx)));
    ny = Math.max(0, Math.min(WORLD_SIZE, Math.round(ny)));
    // Block movement into water / other realms
    if (!isPositionWalkable(nx, ny)) return { x: pos.x, y: pos.y };
    return { x: nx, y: ny };
  }

  /** Called at a fixed interval to sample + send + predict */
  function inputTick() {
    if (!isActive) return;

    const { dx, dz, sprint } = sampleInput();
    if (dx === 0 && dz === 0) return; // standing still — nothing to send

    const seq = ++inputSeq;
    const input = { seq, dx, dz, sprint, yaw: cameraYaw };

    // 1 — Client-side prediction: apply locally
    const predicted = applyInput(serverPos, input);
    serverPos = predicted; // optimistic: assume server will agree

    // 2 — Store for reconciliation
    pendingInputs.push(input);

    // 3 — Send to server
    if (socket && socket.connected) {
      socket.emit('move3d:input', input);
    }
  }

  /**
   * Per-frame smooth movement — called from the render loop.
   * Continuously moves the camera toward the predicted target (serverPos)
   * and also applies real-time local movement so there's zero input lag.
   */
  function updateSmoothMovement(delta) {
    // Apply real-time local movement so the camera responds instantly
    const { dx, dz, sprint } = sampleInput();
    if (dx !== 0 || dz !== 0) {
      const speed = SV_MOVE_SPEED * (sprint ? SV_SPRINT_MUL : 1);
      // Scale to per-second (SV_MOVE_SPEED is per 100ms tick, so ×10 for per-second)
      const perSec = speed * (1000 / INPUT_TICK_MS);
      const cosY = Math.cos(cameraYaw);
      const sinY = Math.sin(cameraYaw);
      const worldDx = dx * cosY + dz * sinY;
      const worldDz = -dx * sinY + dz * cosY;
      visualPos.x += worldDx * perSec * delta;
      visualPos.y += worldDz * perSec * delta;
      visualPos.x = Math.max(0, Math.min(WORLD_SIZE, visualPos.x));
      visualPos.y = Math.max(0, Math.min(WORLD_SIZE, visualPos.y));
      // Block smooth movement into forbidden areas
      if (!isPositionWalkable(Math.round(visualPos.x), Math.round(visualPos.y))) {
        visualPos.x -= worldDx * perSec * delta;
        visualPos.y -= worldDz * perSec * delta;
      }
    }

    // Lerp visual toward the authoritative predicted position to correct drift
    const t = Math.min(1, LERP_FACTOR * delta);
    visualPos.x += (serverPos.x - visualPos.x) * t;
    visualPos.y += (serverPos.y - visualPos.y) * t;

    camera.position.x = visualPos.x;
    camera.position.z = visualPos.y;
    camera.position.y = CAMERA_HEIGHT;

    updatePositionHUD();
  }

  /** Handle server authoritative state */
  function onServerState(data) {
    if (!isActive) return;
    const { seq, x, y } = data;

    // Set authoritative position
    serverPos = { x, y };

    // Drop all inputs the server has already processed
    pendingInputs = pendingInputs.filter(inp => inp.seq > seq);

    // Re-apply any unacknowledged inputs on top of server state
    let reconciledPos = { x: serverPos.x, y: serverPos.y };
    for (const inp of pendingInputs) {
      reconciledPos = applyInput(reconciledPos, inp);
    }
    // The reconciled position becomes our new optimistic serverPos
    serverPos = reconciledPos;
    // visualPos will lerp toward this in the render loop
  }

  function updatePositionHUD() {
    const el = document.getElementById('viewer3d-position');
    if (!el) return;
    el.textContent = `X: ${Math.round(camera.position.x)}  Y: ${Math.round(camera.position.z)}`;
  }

  /* ================================================================
   *  RENDER LOOP
   * ================================================================ */

  function animate() {
    if (!isActive) return;
    animationId = requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.1);
    updateSmoothMovement(delta);
    updateBillboards();
    renderer.render(scene, camera);
  }

  function onResize() {
    if (!isActive || !camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /* ================================================================
   *  SOCKET HELPERS
   * ================================================================ */

  function getSocket() {
    // The game exposes the socket.io connection on window.socket
    if (window.socket && window.socket.connected) return window.socket;
    // Fallback via getSocket helper if available
    if (window.getSocket) {
      const s = window.getSocket();
      if (s && s.connected) return s;
    }
    return null;
  }

  function startNetworking() {
    socket = getSocket();
    if (!socket) {
      console.warn('[3D] No WebSocket available — movement will be local-only');
      // Fall back to local movement if no socket
      inputTickTimer = setInterval(localInputTick, INPUT_TICK_MS);
      return;
    }

    // Tell server we're in 3D mode
    socket.emit('move3d:enter');

    // Listen for authoritative state
    socket.on('move3d:state', onServerState);

    // Start input tick
    inputTickTimer = setInterval(inputTick, INPUT_TICK_MS);
  }

  function stopNetworking() {
    if (inputTickTimer) {
      clearInterval(inputTickTimer);
      inputTickTimer = null;
    }

    if (socket) {
      socket.emit('move3d:exit');
      socket.off('move3d:state', onServerState);
      socket = null;
    }

    pendingInputs = [];
    inputSeq = 0;
  }

  /** Fallback: local-only movement when no socket is available */
  function localInputTick() {
    if (!isActive) return;
    const { dx, dz, sprint } = sampleInput();
    if (dx === 0 && dz === 0) return;

    const input = { dx, dz, sprint, yaw: cameraYaw };
    const newPos = applyInput(serverPos, input);
    serverPos = newPos;
    // visualPos will lerp toward serverPos in the render loop
  }

  /* ================================================================
   *  ENTER / EXIT
   * ================================================================ */

  function enter3DView(rasterX, rasterY) {
    if (isActive) return;

    // Lazy-init
    if (!initialized) init();
    if (!renderer) return;

    isActive = true;

    // Clear previous dynamic objects
    clearDynamicObjects();

    // Set initial position from where the user was on the 2D map
    serverPos = { x: Math.round(rasterX), y: Math.round(rasterY) };
    visualPos = { x: serverPos.x, y: serverPos.y };
    pendingInputs = [];
    inputSeq = 0;

    // Position camera
    camera.position.set(serverPos.x, CAMERA_HEIGHT, serverPos.y);
    camera.fov = DEFAULT_FOV;
    camera.updateProjectionMatrix();
    cameraYaw = 0;
    cameraPitch = -0.05;
    applyCameraRotation();

    // Show container
    container.classList.remove('hidden');
    container.style.display = 'block';

    // Attach pointer events
    container.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd);
    container.style.cursor = 'grab';

    // Hide 2D UI
    toggle2DUI(false);

    // Load world data (screenshots only, no paths in 3D)
    loadWorldData();

    // Start networking + input loop
    startNetworking();

    // Start render loop
    clock.start();
    animate();
  }

  function exit3DView() {
    if (!isActive) return;
    isActive = false;

    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    clock.stop();

    // Stop networking
    stopNetworking();

    // Remove pointer events
    container.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    container.removeEventListener('wheel', onWheel);
    container.removeEventListener('touchstart', onTouchStart);
    container.removeEventListener('touchmove', onTouchMove);
    container.removeEventListener('touchend', onTouchEnd);

    container.classList.add('hidden');
    container.style.display = 'none';

    // Reset key state
    Object.keys(keys).forEach((k) => (keys[k] = false));

    // Show 2D UI
    toggle2DUI(true);

    // Zoom 2D map back one level so we don't immediately re-trigger
    if (window.map) {
      try { window.map.setZoom(window.map.getMaxZoom() - 1); } catch (e) { /* ignore */ }
    }
  }

  function toggle2DUI(show) {
    // Only hide the 2D map and attribution; keep all game HUD/windows visible
    const display = show ? '' : 'none';
    const hideEls = [
      document.getElementById('map'),
      document.getElementById('attribution')
    ];
    hideEls.forEach((el) => { if (el) el.style.display = display; });

    // Boost z-index of all UI elements so they render above the 3D container (z-index 30000)
    const uiEls = [
      document.getElementById('coords'),
      document.getElementById('header-actions'),
      document.getElementById('ui-compass'),
      document.getElementById('ui-character-status'),
      document.getElementById('ui-image-overlay'),
      document.getElementById('ui-server-time'),
      document.getElementById('shoutbox-window'),
      document.getElementById('inventory-window'),
      document.getElementById('character-window'),
      document.getElementById('screenshots-window'),
      document.getElementById('settings-window')
    ];
    document.querySelectorAll('.ui-hud-group').forEach((el) => uiEls.push(el));

    if (!show) {
      uiEls.forEach((el) => {
        if (!el) return;
        el.dataset.viewer3dOrigZ = el.style.zIndex || '';
        const current = parseInt(window.getComputedStyle(el).zIndex) || 0;
        el.style.zIndex = String(Math.max(current, 0) + 31000);
      });
    } else {
      uiEls.forEach((el) => {
        if (!el) return;
        if ('viewer3dOrigZ' in el.dataset) {
          el.style.zIndex = el.dataset.viewer3dOrigZ;
          delete el.dataset.viewer3dOrigZ;
        }
      });
    }
  }

  function clearDynamicObjects() {
    dynamicObjects.forEach((obj) => {
      scene.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (obj.material.map) obj.material.map.dispose();
        obj.material.dispose();
      }
    });
    dynamicObjects = [];
  }

  /* ================================================================
   *  DATA LOADING
   * ================================================================ */

  async function loadWorldData() {
    try {
      const headers = {};
      if (window.gameState && window.gameState.sessionToken) {
        headers['X-Session-Token'] = window.gameState.sessionToken;
      }
      const res = await fetch('/api/screenshots', { headers, credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.screenshots) {
          placeScreenshots(data.screenshots);
        }
      }
    } catch (e) {
      console.warn('[3D] Failed to load screenshots:', e);
    }
  }

  /* ================================================================
   *  PUBLIC API
   * ================================================================ */

  window.viewer3D = {
    enter: enter3DView,
    exit: exit3DView,
    isActive: function () { return isActive; }
  };
})();
