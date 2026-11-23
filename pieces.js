// pieces.js — genuine 3D chess vignette (knight captures queen).
// Lathe-turned queen, extruded sculpted knight head on a turned pedestal,
// a real tiled board with cast shadows. Self-contained Three.js scene.
// Exports: window.ChessVignette. Requires THREE on global scope.

(function () {
  const TAU = Math.PI * 2;

  // ---- Piece profiles (x = radius, y = height), bottom → top ----------
  // Queen: tall turned silhouette — tiered foot, slender concave stem,
  // collar, flared coronet crown that dips into a cup, topped by a ball.
  const QUEEN_PROFILE = [
    [0.00, 0.00], [0.52, 0.00], [0.52, 0.06], [0.45, 0.095], [0.475, 0.13],
    [0.40, 0.17], [0.315, 0.24], [0.225, 0.34], [0.175, 0.52], [0.155, 0.68],
    [0.155, 0.82], [0.185, 0.92], [0.255, 1.00], [0.265, 1.05], [0.215, 1.10],
    [0.20, 1.15], [0.235, 1.19], [0.20, 1.24], [0.30, 1.34], [0.405, 1.46],
    [0.405, 1.50], [0.31, 1.505], [0.20, 1.45], [0.145, 1.47], [0.14, 1.55],
    [0.10, 1.585], [0.00, 1.59],
  ];

  // Knight pedestal: tiered foot + collar the head mounts onto.
  const KNIGHT_BASE_PROFILE = [
    [0.00, 0.00], [0.50, 0.00], [0.50, 0.06], [0.43, 0.095], [0.455, 0.13],
    [0.385, 0.17], [0.30, 0.24], [0.245, 0.34], [0.235, 0.44], [0.275, 0.52],
    [0.285, 0.57], [0.235, 0.62], [0.30, 0.665], [0.30, 0.70], [0.18, 0.71],
  ];

  // Knight head silhouette (profile facing +x, muzzle to the right),
  // extruded along z. Bottom of the neck sits at y = 0. Arched neck,
  // squared muzzle with nostril + mouth, brow, two ears, flowing mane.
  const KNIGHT_HEAD = [
    [0.10, 0.00], [0.28, 0.10], [0.305, 0.34], [0.34, 0.52], [0.47, 0.555],
    [0.66, 0.50], [0.745, 0.55], [0.785, 0.70], [0.72, 0.80], [0.50, 0.865],
    [0.40, 1.00], [0.18, 1.12], [0.055, 1.37], [-0.10, 1.13], [-0.225, 1.35],
    [-0.36, 1.12], [-0.50, 0.92], [-0.45, 0.78], [-0.565, 0.63], [-0.475, 0.49],
    [-0.52, 0.30], [-0.40, 0.00],
  ];

  function latheGeometry(profile, segments) {
    // Run a smooth curve through the profile so the turned piece has
    // soft, polished transitions instead of faceted steps.
    const raw = profile.map((p) => new THREE.Vector3(p[0], p[1], 0));
    const curve = new THREE.CatmullRomCurve3(raw, false, 'centripetal', 0.5);
    const pts = curve.getPoints(profile.length * 10).map(
      (v) => new THREE.Vector2(Math.max(0, v.x), v.y)
    );
    pts[0].set(0, profile[0][1]);
    pts[pts.length - 1].set(0, profile[profile.length - 1][1]);
    const geo = new THREE.LatheGeometry(pts, segments);
    geo.computeVertexNormals();
    return geo;
  }

  function knightHeadGeometry() {
    const shape = new THREE.Shape();
    // Smooth spline through the silhouette points: soft muzzle, rounded
    // ears and a flowing mane instead of straight polygon edges.
    const pts = KNIGHT_HEAD.map((p) => new THREE.Vector2(p[0], p[1]));
    shape.moveTo(pts[0].x, pts[0].y);
    shape.splineThru(pts.slice(1).concat([pts[0].clone()]));
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.52,
      bevelEnabled: true,
      bevelThickness: 0.09,
      bevelSize: 0.08,
      bevelSegments: 8,
      curveSegments: 10,
    });
    geo.translate(0, 0, -0.26); // center on z
    geo.computeVertexNormals();
    return geo;
  }

  class ChessVignette {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.theme = opts.theme || 'light';

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
      this.camera.position.set(0.3, 5.2, 7.4);
      this.camera.lookAt(0, 0.4, 0);

      this.renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true,
      });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.setClearColor(0x000000, 0);

      this._buildLights();
      this._buildBoard();
      this._buildPieces();

      // Board coordinates: square (col,row) → world (x,z). Tile = 1 unit.
      // Knight starts at (-1,1); queen sits at (0,-1). Knight L-move:
      // 1 across + 2 forward → lands on the queen and captures.
      this.knightSq = { c: -1, r: 1 };
      this.queenSq = { c: 0, r: -1 };
      this.knightGroup.position.set(this.knightSq.c, 0, this.knightSq.r);
      this.queenGroup.position.set(this.queenSq.c, 0, this.queenSq.r);

      // Animation state
      this.playing = false;
      this.t0 = 0;
      this.done = false;
      this.spin = 0;

      this._resize();
      this._ro = new ResizeObserver(() => this._resize());
      this._ro.observe(canvas);

      this._last = performance.now();
      this._loop = this._loop.bind(this);
      requestAnimationFrame(this._loop);
    }

    _buildLights() {
      this.hemi = new THREE.HemisphereLight(0xffffff, 0x40404a, 0.55);
      this.scene.add(this.hemi);
      this.ambient = new THREE.AmbientLight(0xffffff, 0.35);
      this.scene.add(this.ambient);

      this.key = new THREE.DirectionalLight(0xffffff, 1.15);
      this.key.position.set(4.5, 8, 5);
      this.key.castShadow = true;
      this.key.shadow.mapSize.set(1024, 1024);
      this.key.shadow.camera.near = 1;
      this.key.shadow.camera.far = 30;
      const d = 7;
      this.key.shadow.camera.left = -d;
      this.key.shadow.camera.right = d;
      this.key.shadow.camera.top = d;
      this.key.shadow.camera.bottom = -d;
      this.key.shadow.bias = -0.0004;
      this.key.shadow.radius = 4;
      this.scene.add(this.key);

      this.rim = new THREE.DirectionalLight(0xc4f4f4, 0.4);
      this.rim.position.set(-5, 3, -4);
      this.scene.add(this.rim);
    }

    _boardColors() {
      return this.theme === 'dark'
        ? { light: 0x4a3729, dark: 0x2b1e17, edge: 0x1a120d }
        : { light: 0xe3f9f9, dark: 0x9fd6d6, edge: 0x7fb8b8 };
    }

    _buildBoard() {
      this.board = new THREE.Group();
      this.scene.add(this.board);

      const c = this._boardColors();
      this.boardTiles = [];
      const N = 5; // 5x5 region centered at origin
      const half = (N - 1) / 2;
      const tileGeo = new THREE.BoxGeometry(1, 0.28, 1);
      for (let col = 0; col < N; col++) {
        for (let row = 0; row < N; row++) {
          const x = col - half;
          const z = row - half;
          const isDark = (col + row) % 2 === 1;
          const mat = new THREE.MeshStandardMaterial({
            color: isDark ? c.dark : c.light,
            roughness: 0.92,
            metalness: 0.02,
          });
          const tile = new THREE.Mesh(tileGeo, mat);
          tile.position.set(x, -0.14, z);
          tile.receiveShadow = true;
          tile.castShadow = false;
          tile.userData.isDark = isDark;
          this.board.add(tile);
          this.boardTiles.push(tile);
        }
      }

      // Plinth under the tiles for a solid edge.
      const plinthMat = new THREE.MeshStandardMaterial({
        color: c.edge, roughness: 0.85, metalness: 0.05,
      });
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(N + 0.3, 0.34, N + 0.3), plinthMat);
      plinth.position.set(0, -0.34, 0);
      plinth.receiveShadow = true;
      plinth.castShadow = false;
      this.board.add(plinth);
      this.plinth = plinth;
    }

    _buildPieces() {
      // Queen — warm metallic gold (echoes the site's orange accent).
      this.queenMat = new THREE.MeshStandardMaterial({
        color: this.theme === 'dark' ? 0xc4f4f4 : 0x2f8f92,
        roughness: 0.34,
        metalness: 0.55,
        emissive: 0x06201f,
        emissiveIntensity: 0.18,
      });
      // Knight — dark graphite plastic.
      this.knightMat = new THREE.MeshStandardMaterial({
        color: this.theme === 'dark' ? 0xb5794a : 0x2b1e17,
        roughness: 0.5,
        metalness: 0.18,
      });

      // --- Queen group ---
      this.queenGroup = new THREE.Group();
      const qBody = new THREE.Mesh(latheGeometry(QUEEN_PROFILE, 72), this.queenMat);
      qBody.castShadow = true;
      qBody.receiveShadow = true;
      this.queenGroup.add(qBody);
      // crown ball finial on top
      const qBall = new THREE.Mesh(new THREE.SphereGeometry(0.14, 32, 24), this.queenMat);
      qBall.position.y = 1.65;
      qBall.castShadow = true;
      this.queenGroup.add(qBall);
      // pearl coronet — ring of small spheres around the crown rim
      const pearlGeo = new THREE.SphereGeometry(0.052, 20, 16);
      const PEARLS = 9;
      for (let i = 0; i < PEARLS; i++) {
        const a = (i / PEARLS) * Math.PI * 2;
        const pearl = new THREE.Mesh(pearlGeo, this.queenMat);
        pearl.position.set(Math.cos(a) * 0.385, 1.515, Math.sin(a) * 0.385);
        pearl.castShadow = true;
        this.queenGroup.add(pearl);
      }
      this.queenGroup.scale.setScalar(0.6);
      this.scene.add(this.queenGroup);

      // --- Knight group ---
      this.knightGroup = new THREE.Group();
      const kBase = new THREE.Mesh(latheGeometry(KNIGHT_BASE_PROFILE, 72), this.knightMat);
      kBase.castShadow = true;
      kBase.receiveShadow = true;
      this.knightGroup.add(kBase);
      const kHead = new THREE.Mesh(knightHeadGeometry(), this.knightMat);
      kHead.castShadow = true;
      kHead.receiveShadow = true;
      kHead.position.y = 0.6;
      kHead.scale.setScalar(0.82);
      this.knightHead = kHead;
      this.knightGroup.add(kHead);
      this.knightGroup.scale.setScalar(0.6);
      this.scene.add(this.knightGroup);
    }

    setTheme(theme) {
      this.theme = theme;
      const c = this._boardColors();
      const half = 2;
      for (const tile of this.boardTiles) {
        tile.material.color.setHex(tile.userData.isDark ? c.dark : c.light);
      }
      if (this.plinth) this.plinth.material.color.setHex(c.edge);
      this.queenMat.color.setHex(theme === 'dark' ? 0xc4f4f4 : 0x2f8f92);
      this.knightMat.color.setHex(theme === 'dark' ? 0xb5794a : 0x2b1e17);
      this.rim.intensity = theme === 'dark' ? 0.55 : 0.4;
    }

    play() {
      if (this.playing || this.done) return;
      this.playing = true;
      this.t0 = performance.now() + 2000; // wait 2s after it scrolls into view
    }

    reset() {
      this.playing = false;
      this.done = false;
      this.knightGroup.position.set(this.knightSq.c, 0, this.knightSq.r);
      this.knightGroup.rotation.set(0, 0, 0);
      this.knightGroup.scale.setScalar(0.6);
      this.queenGroup.position.set(this.queenSq.c, 0, this.queenSq.r);
      this.queenGroup.rotation.set(0, 0, 0);
      this.queenGroup.scale.setScalar(0.6);
      this.queenGroup.visible = true;
      this._setQueenOpacity(1);
    }

    _setQueenOpacity(o) {
      this.queenMat.transparent = o < 1;
      this.queenMat.opacity = o;
    }

    _animate(now) {
      const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
      const easeOut = (t) => 1 - Math.pow(1 - t, 3);
      const clamp01 = (v) => Math.max(0, Math.min(1, v));

      if (now < this.t0) return; // still in the 2s pause
      const DUR = 1700;
      const t = Math.min(1, (now - this.t0) / DUR);
      const S = this.knightSq, E = this.queenSq;
      const BASE = 0.6;

      // 0.00–0.10 coil · 0.10–0.48 one fast, high leap · 0.48 SLAM · rest: queen flies
      const coil = clamp01(t / 0.10);
      const u = easeInOut(clamp01((t - 0.10) / 0.38));
      const landed = t >= 0.48;
      const impact = clamp01((t - 0.48) / 0.10);

      // Arc through the L corner, high and fast.
      const cx = S.c, cz = E.r, iu = 1 - u;
      const x = iu * iu * S.c + 2 * iu * u * cx + u * u * E.c;
      const z = iu * iu * S.r + 2 * iu * u * cz + u * u * E.r;
      const lift = landed ? 0 : Math.sin(u * Math.PI) * 2.6;
      this.knightGroup.position.set(x, lift, z);

      // Coil down, stretch in the air, hard squash on impact.
      let sy = 1;
      if (t < 0.10) sy = 1 - Math.sin(coil * Math.PI * 0.5) * 0.18;
      else if (!landed) sy = 1 + Math.sin(u * Math.PI) * 0.08;
      else sy = 1 - Math.sin(impact * Math.PI) * 0.22;
      const sxz = 1 + (1 - sy) * 0.5;
      this.knightGroup.scale.set(BASE * sxz, BASE * sy, BASE * sxz);

      // Dive forward through the leap.
      const air = landed ? 0 : Math.sin(u * Math.PI);
      this.knightGroup.rotation.x = -0.35 * air * (u < 0.5 ? 0.6 : 1);
      this.knightGroup.rotation.z = -0.2 * air;

      // Camera shake on impact.
      if (landed && impact < 1) {
        const k = (1 - impact) * 0.09;
        this.camera.position.x += (Math.random() - 0.5) * k;
        this.camera.position.y += (Math.random() - 0.5) * k;
      }

      // Queen: nudged back a little, tips over, fades. No flying.
      if (!landed) {
        this.queenGroup.rotation.set(0, 0, 0);
        this.queenGroup.position.set(E.c, 0, E.r);
      } else {
        const q = easeOut(clamp01((t - 0.48) / 0.52));
        const dx = E.c - S.c, dz = E.r - S.r, len = Math.hypot(dx, dz) || 1;
        const dist = q * 0.7;
        this.queenGroup.position.set(E.c + (dx / len) * dist, 0, E.r + (dz / len) * dist);
        this.queenGroup.rotation.set(0, 0, q * 1.35);
        this._setQueenOpacity(1 - clamp01((q - 0.5) / 0.5));
      }

      if (t >= 1) {
        this.playing = false;
        this.done = true;
        this.queenGroup.visible = false;
        this.knightGroup.scale.setScalar(BASE);
        this.knightGroup.rotation.set(0, 0, 0);
      }
    }

    _idle(dt) {
      // gentle breathing orbit for life
      this.spin += dt * 0.12;
      const yaw = Math.sin(this.spin) * 0.16;
      const r = 7.2;
      this.camera.position.x = Math.sin(yaw) * r + 0.3 * Math.cos(yaw);
      this.camera.position.z = Math.cos(yaw) * r;
      this.camera.position.y = 4.9;
      this.camera.lookAt(0, 0.82, 0.1);
    }

    _resize() {
      const r = this.canvas.getBoundingClientRect();
      const w = Math.max(2, r.width), h = Math.max(2, r.height);
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }

    _loop(now) {
      const dt = Math.min(0.05, (now - this._last) / 1000);
      this._last = now;
      this._idle(dt);
      if (this.playing) this._animate(now);
      try {
        this.renderer.render(this.scene, this.camera);
      } catch (e) {
        console.error('[pieces] frame error', e);
      }
      requestAnimationFrame(this._loop);
    }
  }

  window.ChessVignette = ChessVignette;
})();
