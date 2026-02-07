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
 */
(function () {
  'use strict';

  /* ─── constants ─── */
  const WORLD_SIZE = 6144;
  const CAMERA_HEIGHT = 10;
  const MOVE_SPEED = 40;           // world-units / second
  const SPRINT_MULTIPLIER = 3;
  const LOOK_SPEED = 0.003;
  const SCROLL_MOVE = 8;           // forward distance per scroll tick
  const PATH_HEIGHT = 4;           // paths hover slightly above ground
  const SCREENSHOT_HEIGHT = 150;   // billboard center height
  const SCREENSHOT_WIDTH = 200;    // max billboard width
  const FOG_DENSITY = 0.00025;
  const SKY_COLOR = 0x7ec8e3;
  const GROUND_COLOR = 0x4a7c3f;
  const DEFAULT_FOV = 75;
  const MIN_FOV = 20;
  const MAX_FOV = 110;
  const ZOOM_STEP = 3;              // FOV degrees per scroll tick

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
        // Row 1 = top of map = rasterY [0 … tileSize] → 3D Z [0 … tileSize]
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
          // Failed – keep the fallback green color
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

      // Smooth tube
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
        // Fallback: simple line
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

      // ── Pole from ground to billboard ──
      const poleH = SCREENSHOT_HEIGHT;
      const poleGeo = new THREE.CylinderGeometry(1.2, 1.2, poleH, 6);
      const poleMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(wx, poleH / 2, wz);
      scene.add(pole);
      dynamicObjects.push(pole);

      // ── Billboard frame (placeholder) ──
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

      // ── Load screenshot texture ──
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

      // ── Label sprite ──
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

      // ── Small ground marker dot ──
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
   *  BILLBOARD FACING  – make screenshot planes face the camera
   * ================================================================ */

  function updateBillboards() {
    dynamicObjects.forEach((obj) => {
      if (obj.isMesh && obj.geometry && obj.geometry.type === 'PlaneGeometry' && obj.material && obj.material.map) {
        // Only rotate horizontally so they don't tilt
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
    // Scroll zooms in/out by adjusting field of view
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

  function updateMovement(delta) {
    const speed = MOVE_SPEED * delta;
    const sprint = (keys['ShiftLeft'] || keys['ShiftRight']) ? SPRINT_MULTIPLIER : 1;

    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();

    const right = new THREE.Vector3();
    right.crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();

    const move = new THREE.Vector3();
    if (keys['KeyW'] || keys['ArrowUp']) move.add(fwd);
    if (keys['KeyS'] || keys['ArrowDown']) move.sub(fwd);
    if (keys['KeyA'] || keys['ArrowLeft']) move.sub(right);
    if (keys['KeyD'] || keys['ArrowRight']) move.add(right);

    if (move.lengthSq() > 0) {
      move.normalize();
      camera.position.addScaledVector(move, speed * sprint);
    }

    // Clamp to world bounds
    camera.position.x = Math.max(0, Math.min(WORLD_SIZE, camera.position.x));
    camera.position.z = Math.max(0, Math.min(WORLD_SIZE, camera.position.z));
    camera.position.y = CAMERA_HEIGHT;

    // Update HUD position display
    updatePositionHUD();
  }

  function updatePositionHUD() {
    const el = document.getElementById('viewer3d-position');
    if (!el) return;
    const rx = Math.round(camera.position.x);
    const ry = Math.round(camera.position.z);
    el.textContent = `X: ${rx}  Y: ${ry}`;
  }

  /* ================================================================
   *  RENDER LOOP
   * ================================================================ */

  function animate() {
    if (!isActive) return;
    animationId = requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.1);
    updateMovement(delta);
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
   *  ENTER / EXIT
   * ================================================================ */

  /**
   * Enter the 3D view centred on the given raster coordinates.
   * @param {number} rasterX
   * @param {number} rasterY
   */
  function enter3DView(rasterX, rasterY) {
    if (isActive) return;

    // Lazy-init
    if (!initialized) init();
    if (!renderer) return;

    isActive = true;

    // Clear previous dynamic objects
    clearDynamicObjects();

    // Position camera
    camera.position.set(rasterX, CAMERA_HEIGHT, rasterY);
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

    // Load world data
    loadWorldData();

    // Start render
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
    const display = show ? '' : 'none';
    const els = [
      document.getElementById('map'),
      document.getElementById('coords'),
      document.getElementById('header-actions'),
      document.getElementById('ui-compass'),
      document.getElementById('ui-character-status'),
      document.getElementById('ui-image-overlay'),
      document.getElementById('attribution')
    ];
    els.forEach((el) => { if (el) el.style.display = display; });

    // Also hide any open game windows
    if (!show) {
      document.querySelectorAll('.ui-hud-group, #shoutbox-window, #inventory-window, #character-window, #screenshots-window, #settings-window').forEach((el) => {
        el.dataset.viewer3dPrevDisplay = el.style.display;
        el.style.display = 'none';
      });
    } else {
      document.querySelectorAll('[data-viewer3d-prev-display]').forEach((el) => {
        el.style.display = el.dataset.viewer3dPrevDisplay || '';
        delete el.dataset.viewer3dPrevDisplay;
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
    // Paths (already available via WebSocket)
    try {
      const paths = (window.gameState && window.gameState.pathsData) || [];
      if (paths.length > 0) {
        drawPaths(paths);
      } else {
        // Try fetching if not loaded yet
        const res = await fetch('/api/paths', { credentials: 'same-origin' });
        if (res.ok) {
          const data = await res.json();
          if (data && data.paths) drawPaths(data.paths);
        }
      }
    } catch (e) {
      console.warn('[3D] Failed to load paths:', e);
    }

    // Screenshots
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
