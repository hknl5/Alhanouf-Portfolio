// cube.js — Rubik's cube renderer + scroll-driven solver
// Exports: window.RubiksCube
// Requires THREE on global scope.

(function () {
  // Bright, true Rubik's colors — minimal shading so they read as flat colors.
  const COLORS = {
    R: '#ee3b3b', // right (+x) red
    O: '#ff8e1c', // left  (-x) orange
    U: '#e7e7e7', // up    (+y) white
    D: '#ffd60a', // down  (-y) yellow
    F: '#34c759', // front (+z) green
    B: '#1f7af0', // back  (-z) blue
    X: '#474752', // inner / cube body
  };

  // Move helpers: {axis, layer, dir}.
  // dir = +1 means rotate by +90deg about the positive axis.
  // For visual "clockwise looking at that face from outside" notation:
  //   U  = ('y', +1, -1)   Ui = ('y', +1, +1)
  //   D  = ('y', -1, +1)   Di = ('y', -1, -1)
  //   R  = ('x', +1, -1)   Ri = ('x', +1, +1)
  //   L  = ('x', -1, +1)   Li = ('x', -1, -1)
  //   F  = ('z', +1, -1)   Fi = ('z', +1, +1)
  //   B  = ('z', -1, +1)   Bi = ('z', -1, -1)
  const m = (axis, layer, dir) => ({ axis, layer, dir });
  const MOVES = {
    U: m('y', 1, -1),  Ui: m('y', 1, 1),  U2: m('y', 1, -1),
    D: m('y', -1, 1),  Di: m('y', -1, -1),
    R: m('x', 1, -1),  Ri: m('x', 1, 1),
    L: m('x', -1, 1),  Li: m('x', -1, -1),
    F: m('z', 1, -1),  Fi: m('z', 1, 1),
    B: m('z', -1, 1),  Bi: m('z', -1, -1),
  };
  // (U2 etc. handled by listing the move twice)

  function parseMoves(str) {
    // string like "R U R' U' F R U" → array of move objects
    // tokens separated by spaces. Apostrophe = inverse. "2" = double.
    const tokens = str.trim().split(/\s+/).filter(Boolean);
    const out = [];
    for (const t of tokens) {
      const base = t[0];
      const mod = t.slice(1);
      let mv;
      switch (base) {
        case 'U': mv = MOVES.U; break;
        case 'D': mv = MOVES.D; break;
        case 'L': mv = MOVES.L; break;
        case 'R': mv = MOVES.R; break;
        case 'F': mv = MOVES.F; break;
        case 'B': mv = MOVES.B; break;
        default: continue;
      }
      if (mod === "'") {
        out.push({ ...mv, dir: -mv.dir });
      } else if (mod === '2') {
        out.push(mv);
        out.push(mv);
      } else {
        out.push(mv);
      }
    }
    return out;
  }

  // Build a Rubik's-style rounded box: standard BoxGeometry (so per-face
  // material groups are preserved), with each vertex pushed outward toward
  // a sphere of `radius` based on its position relative to the inner cuboid.
  function makeRoundedBox(size, radius, segments) {
    const geo = new THREE.BoxGeometry(size, size, size, segments, segments, segments);
    const pos = geo.attributes.position;
    const half = size / 2;
    const inner = half - radius;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const cx = Math.max(-inner, Math.min(inner, x));
      const cy = Math.max(-inner, Math.min(inner, y));
      const cz = Math.max(-inner, Math.min(inner, z));
      const dx = x - cx, dy = y - cy, dz = z - cz;
      const len = Math.hypot(dx, dy, dz);
      if (len > 1e-6) {
        const k = radius / len;
        pos.setXYZ(i, cx + dx * k, cy + dy * k, cz + dz * k);
      }
    }
    geo.computeVertexNormals();
    return geo;
  }

  class RubiksCube {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
      this.cameraTarget = new THREE.Vector3(0, 0, 0);
      this.camera.position.set(7, 5, 9);
      this.camera.lookAt(this.cameraTarget);

      this.renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true,
      });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.setClearColor(0x000000, 0);

      // Lighting — high ambient so colors read flat and bright; soft rim
      // for depth only on the rounded corners.
      this.ambient = new THREE.AmbientLight(0xffffff, 1.05);
      this.scene.add(this.ambient);
      this.keyLight = new THREE.DirectionalLight(0xffffff, 0.35);
      this.keyLight.position.set(6, 9, 6);
      this.scene.add(this.keyLight);
      this.rimLight = new THREE.DirectionalLight(0xffffff, 0.25);
      this.rimLight.position.set(-6, 2, -4);
      this.scene.add(this.rimLight);

      // Container for the cube + pivot. We don't translate it; the camera
      // is shifted instead so the cube can appear left/center/right on screen
      // regardless of orbit yaw.
      this.world = new THREE.Group();
      this.scene.add(this.world);

      this.cubeGroup = new THREE.Group();
      this.world.add(this.cubeGroup);
      this.pivot = new THREE.Group();
      this.world.add(this.pivot);

      this.cubies = [];
      this.buildCubies();

      // Sequence state
      this.moves = [];
      this.bakedIndex = 0;
      this.currentPartialMove = null;

      // Scroll progress
      this.targetProgress = 0;
      this.smoothProgress = 0;

      // Orbit / idle camera anim
      this.spinPhase = 0;
      this.targetScreenShift = new THREE.Vector2(0, 0);
      this.screenShift = new THREE.Vector2(0, 0);

      // Theme-driven appearance
      this.theme = opts.theme || 'light';

      this.resize();
      window.addEventListener('resize', () => this.resize());
    }

    buildCubies() {
      // Slightly larger cubies → tighter gap. Cubies sit on integer
      // lattice (-1, 0, +1) so gap = 1 - size between adjacent cubies.
      const size = 0.97;
      const radius = 0.11;
      const geo = makeRoundedBox(size, radius, 6);
      // BoxGeometry face order in 'materials' array:
      // 0: +x, 1: -x, 2: +y, 3: -y, 4: +z, 5: -z
      const mkMat = (hex) => {
        const isSticker = hex !== COLORS.X;
        const c = new THREE.Color(hex);
        if (!isSticker) {
          return new THREE.MeshStandardMaterial({
            color: hex,
            roughness: 0.85,
            metalness: 0.0,
          });
        }
        // Sticker faces: MeshLambertMaterial with emissive baked in so
        // the color stays vivid even on shaded corners. No metalness, no
        // specular highlights — reads as flat plastic sticker.
        return new THREE.MeshLambertMaterial({
          color: hex,
          emissive: c,
          emissiveIntensity: 0.55,
        });
      };
      for (let x = -1; x <= 1; x++) {
        for (let y = -1; y <= 1; y++) {
          for (let z = -1; z <= 1; z++) {
            const mats = [
              mkMat(x ===  1 ? COLORS.R : COLORS.X),
              mkMat(x === -1 ? COLORS.O : COLORS.X),
              mkMat(y ===  1 ? COLORS.U : COLORS.X),
              mkMat(y === -1 ? COLORS.D : COLORS.X),
              mkMat(z ===  1 ? COLORS.F : COLORS.X),
              mkMat(z === -1 ? COLORS.B : COLORS.X),
            ];
            const mesh = new THREE.Mesh(geo, mats);
            mesh.position.set(x, y, z);
            // Subtle inset shade around each cubie — a slightly larger
            // dark cube behind the sticker block. Keeps the "sticker on
            // black plastic" feel without overlaying hard wireframe edges
            // (which look wrong on a rounded surface).
            this.cubeGroup.add(mesh);
            this.cubies.push(mesh);
          }
        }
      }
    }

    cubiesInLayer(axis, layer) {
      return this.cubies.filter(
        (c) => Math.round(c.position[axis]) === layer
      );
    }

    // Helpers for exact-math moves
    _axisVec(axis) {
      const v = new THREE.Vector3();
      v[axis] = 1;
      return v;
    }

    // Apply a full move using exact math: rotate each layer cubie's position
    // and quaternion by ±90°. Avoids any floating-point drift over many moves.
    bakeMove(move) {
      if (this.currentPartialMove) this.unwindPartial();
      const ang = (Math.PI / 2) * move.dir;
      const axisVec = this._axisVec(move.axis);
      const q = new THREE.Quaternion().setFromAxisAngle(axisVec, ang);
      const layerCubies = this.cubiesInLayer(move.axis, move.layer);
      for (const c of layerCubies) {
        c.position.applyAxisAngle(axisVec, ang);
        c.position.x = Math.round(c.position.x);
        c.position.y = Math.round(c.position.y);
        c.position.z = Math.round(c.position.z);
        c.quaternion.premultiply(q);
        c.quaternion.normalize();
      }
    }

    // Live partial rotation via temporary pivot. Cubies are attached at
    // identity (preserving world), THEN the pivot rotates so they follow.
    setPartial(move, progress) {
      if (this.currentPartialMove) {
        if (this.currentPartialMove === move) {
          // just update angle
          const ang = (Math.PI / 2) * move.dir * progress;
          this.pivot.rotation.set(0, 0, 0);
          this.pivot.rotation[move.axis] = ang;
          return;
        }
        this.unwindPartial();
      }
      if (!move) return;
      this.currentPartialMove = move;
      this.pivot.rotation.set(0, 0, 0);
      const layerCubies = this.cubiesInLayer(move.axis, move.layer);
      for (const c of layerCubies) this.pivot.attach(c);
      const ang = (Math.PI / 2) * move.dir * progress;
      this.pivot.rotation[move.axis] = ang;
    }

    // Cancel any in-progress partial WITHOUT committing it.
    unwindPartial() {
      const kids = [...this.pivot.children];
      this.pivot.rotation.set(0, 0, 0);
      for (const c of kids) this.cubeGroup.attach(c);
      this.currentPartialMove = null;
    }

    setSolveSequence(moves) {
      // moves: string OR array. Stores normalized array; starts cube already
      // scrambled by applying the INVERSE of the sequence (in reverse order),
      // so that forward play returns it to solved.
      const arr = typeof moves === 'string' ? parseMoves(moves) : moves;
      this.moves = arr.slice();
      // start solved → scramble
      const reversed = [...this.moves]
        .reverse()
        .map((mv) => ({ ...mv, dir: -mv.dir }));
      for (const mv of reversed) this.bakeMove(mv);
      this.bakedIndex = 0;
    }

    syncTo(targetIndex, partial) {
      // unwind any partial first; we may apply exact moves below
      if (this.currentPartialMove && this.bakedIndex !== targetIndex) {
        this.unwindPartial();
      }
      // bake forward to targetIndex
      while (this.bakedIndex < targetIndex) {
        this.bakeMove(this.moves[this.bakedIndex]);
        this.bakedIndex++;
      }
      // unbake backward
      while (this.bakedIndex > targetIndex) {
        this.bakedIndex--;
        const mv = this.moves[this.bakedIndex];
        this.bakeMove({ axis: mv.axis, layer: mv.layer, dir: -mv.dir });
      }
      // apply partial of move at targetIndex
      if (partial > 0 && targetIndex < this.moves.length) {
        this.setPartial(this.moves[targetIndex], partial);
      } else if (this.currentPartialMove) {
        this.unwindPartial();
      }
    }

    setProgress(p) {
      this.targetProgress = Math.max(0, Math.min(1, p));
    }

    setScreenShift(x, y) {
      // Screen-space shift in world units at the cube's depth.
      // Positive x → cube appears further LEFT (camera frame moves right).
      this.targetScreenShift.set(x, y);
    }

    setTheme(theme) {
      this.theme = theme;
      // Bright flat-color look in both themes; rim color shifts subtly.
      if (theme === 'dark') {
        this.ambient.intensity = 0.95;
        this.keyLight.intensity = 0.4;
        this.rimLight.intensity = 0.4;
        this.rimLight.color.setHex(0x7cc6ff);
      } else {
        this.ambient.intensity = 1.1;
        this.keyLight.intensity = 0.35;
        this.rimLight.intensity = 0.25;
        this.rimLight.color.setHex(0xffffff);
      }
    }

    resize() {
      const r = this.canvas.getBoundingClientRect();
      const w = Math.max(2, r.width), h = Math.max(2, r.height);
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      // shrink fov slightly on portrait screens
      this.camera.fov = w < h ? 36 : 28;
      this.camera.updateProjectionMatrix();
    }

    update(dt, t) {
      // Smooth scroll progress
      const k = Math.min(1, dt * 7);
      this.smoothProgress += (this.targetProgress - this.smoothProgress) * k;

      const N = this.moves.length;
      if (N > 0) {
        const f = this.smoothProgress * N;
        const idx = Math.max(0, Math.min(N, Math.floor(f)));
        const sub = f - Math.floor(f);
        const clampedIdx = idx >= N ? N : idx;
        this.syncTo(clampedIdx, clampedIdx < N ? sub : 0);
      }

      // Idle cinematic orbit
      this.spinPhase += dt * 0.15;
      const r = 11;
      const yaw = this.spinPhase * 0.35;
      const pitch = 0.45 + Math.sin(this.spinPhase * 0.4) * 0.12;
      const baseCam = new THREE.Vector3(
        Math.cos(yaw) * r * Math.cos(pitch),
        Math.sin(pitch) * r + 1.2,
        Math.sin(yaw) * r * Math.cos(pitch)
      );

      // Lerp screen-space shift
      this.screenShift.lerp(this.targetScreenShift, Math.min(1, dt * 3));

      // Compute camera right & up from the gaze direction (baseCam → origin)
      const gaze = baseCam.clone().negate().normalize();
      const worldUp = new THREE.Vector3(0, 1, 0);
      const camRight = new THREE.Vector3().crossVectors(gaze, worldUp).normalize();
      const camUp = new THREE.Vector3().crossVectors(camRight, gaze).normalize();
      const offset = camRight
        .multiplyScalar(this.screenShift.x)
        .add(camUp.multiplyScalar(this.screenShift.y));

      this.camera.position.copy(baseCam).add(offset);
      this.cameraTarget.copy(offset);
      this.camera.lookAt(this.cameraTarget);
    }

    render() {
      this.renderer.render(this.scene, this.camera);
    }
  }

  RubiksCube.parseMoves = parseMoves;
  window.RubiksCube = RubiksCube;
})();
