// scene.js — page orchestration: scroll progress, theme toggle,
// ambient chess pieces, knight-vs-queen vignette trigger.

(function () {
  // ---------------------------------------------------------
  // 0. Boot Three.js cube
  // ---------------------------------------------------------
  const canvas = document.getElementById('cube-canvas');
  const cube = new window.RubiksCube(canvas);
  window.__cube = cube;

  // 24-move solve sequence (visually varied, ends in solved state).
  // The cube auto-scrambles by applying the inverse on init.
  const SOLVE = "R U R' U R U2 R' F R U R' U' F' U L U' L' U' F' U F R U R'";
  cube.setSolveSequence(SOLVE);

  // ---------------------------------------------------------
  // 1. Scroll progress driving the cube
  // ---------------------------------------------------------
  const progressEl = document.querySelector('.progress');
  const progressBar = document.querySelector('.progress .bar');
  const progressLabel = document.querySelector('.progress .label .v');
  const sections = Array.from(document.querySelectorAll('.section, .hero'));

  // Each section's screen-space shift for the cube. Positive x → cube on the
  // LEFT half of the viewport.
  const SHIFT_FOR_ID = {
    'hero':        { x:  0.0, y: 0.0 },
    'about':       { x:  2.4, y: 0.2 },
    'education':   { x: -2.4, y: 0.0 },
    'experience':  { x:  2.4, y: 0.0 },
    'projects':    { x:  0.0, y: 0.6 },
    'skills':      { x: -2.4, y: 0.0 },
    'awards':      { x:  3.0, y: 0.2 },
    'leadership':  { x: -2.4, y: 0.0 },
    'contact':     { x:  0.0, y: 0.0 },
  };

  function currentSectionShift() {
    // Find which section is most "in view" (center of viewport)
    const vh = window.innerHeight;
    const cy = window.scrollY + vh * 0.5;
    let best = sections[0], bestDist = Infinity;
    for (const s of sections) {
      const top = s.offsetTop;
      const mid = top + s.offsetHeight / 2;
      const d = Math.abs(mid - cy);
      if (d < bestDist) { bestDist = d; best = s; }
    }
    return { id: best.id, shift: SHIFT_FOR_ID[best.id] || { x: 0, y: 0 } };
  }

  function onScroll() {
    const docH = document.documentElement.scrollHeight - window.innerHeight;
    const p = docH > 0 ? Math.max(0, Math.min(1, window.scrollY / docH)) : 0;
    cube.setProgress(p);

    // Update progress meter
    if (progressBar) progressBar.style.setProperty('--p', p);
    if (progressLabel) progressLabel.textContent = String(Math.round(p * 100)).padStart(2, '0') + '%';

    // Update active section marker on nav
    const { id, shift } = currentSectionShift();
    cube.setScreenShift(shift.x, shift.y);
    document.documentElement.dataset.section = id;
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ---------------------------------------------------------
  // 2. Theme toggle (light default, dark optional)
  // ---------------------------------------------------------
  const themeBtn = document.querySelector('.theme-toggle');
  const themeLabel = themeBtn.querySelector('.t-label');
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    cube.setTheme(theme);
    if (window.__vignette) window.__vignette.setTheme(theme);
    themeLabel.textContent = theme === 'dark' ? 'Light' : 'Dark';
    try { localStorage.setItem('portfolio-theme', theme); } catch (e) {}
  }
  let initial = 'light';
  try {
    const saved = localStorage.getItem('portfolio-theme');
    if (saved === 'dark' || saved === 'light') initial = saved;
  } catch (e) {}
  applyTheme(initial);
  themeBtn.addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || 'light';
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  });

  // ---------------------------------------------------------
  // 3. Ambient chess pieces (subtle drift across page)
  // ---------------------------------------------------------
  const chessLayer = document.querySelector('.chess-ambient');
  const PIECE_SVGS = {
    // Simple chess-piece glyph silhouettes (small, monochrome).
    knight: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M22 56h22v-4H22zM44 50H22c-1-6 2-10 7-14-6-1-9-5-9-10 0-7 6-13 14-13 6 0 11 4 13 10 3 7 1 14-2 19-3 5-2 7-1 8z M27 24a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/></svg>`,
    bishop: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M28 56h8v-4h-8zM38 50H26l-2-6c0-5 3-9 5-13-3-2-4-5-2-8 1-2 3-3 5-3s4 1 5 3c2 3 1 6-2 8 2 4 5 8 5 13z"/></svg>`,
    pawn:   `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M26 56h12v-4H26zM38 50H26l-1-7c0-4 3-7 6-9-2-1-3-3-3-5 0-3 2-5 5-5s5 2 5 5c0 2-1 4-3 5 3 2 6 5 6 9z"/></svg>`,
    rook:   `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M24 56h16v-4H24zM38 50H26l-1-12h2v-6h-4v-8h4v3h4v-3h4v3h4v-3h4v8h-4v6h2z"/></svg>`,
  };
  function spawnPiece() {
    const types = Object.keys(PIECE_SVGS);
    const t = types[Math.floor(Math.random() * types.length)];
    const el = document.createElement('div');
    el.className = 'chess-piece';
    el.innerHTML = PIECE_SVGS[t];
    const size = 40 + Math.random() * 80;
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.left = (Math.random() * 100) + '%';
    el.style.top = (Math.random() * 100) + '%';
    el.style.animationDuration = (12 + Math.random() * 16) + 's';
    el.style.animationDelay = (-Math.random() * 12) + 's';
    chessLayer.appendChild(el);
  }
  for (let i = 0; i < 9; i++) spawnPiece();

  // ---------------------------------------------------------
  // 4. Knight vs Queen — genuine 3D vignette (Three.js).
  // The knight hops a real L-move across the board, lands on the
  // queen's square and captures her (she topples + fades). Plays
  // when scrolled into view, resets when it leaves.
  // ---------------------------------------------------------
  const knightScene = document.querySelector('.knight-scene');
  const chessCanvas = document.getElementById('chess-canvas');
  let vignette = null;
  if (knightScene && chessCanvas && window.ChessVignette) {
    vignette = new window.ChessVignette(chessCanvas, {
      theme: document.documentElement.dataset.theme || 'light',
    });
    window.__vignette = vignette;

    let played = false;
    const checkKnight = () => {
      const r = knightScene.getBoundingClientRect();
      const vh = window.innerHeight;
      const visible = Math.min(r.bottom, vh) - Math.max(r.top, 0);
      const ratio = visible / Math.min(r.height, vh);
      if (ratio > 0.3 && !played) {
        played = true;
        vignette.play();
      } else if ((r.top > vh || r.bottom < 0) && played) {
        played = false;
        vignette.reset();
      }
    };
    window.addEventListener('scroll', checkKnight, { passive: true });
    window.addEventListener('resize', checkKnight);
    setTimeout(checkKnight, 300);
  }

  // ---------------------------------------------------------
  // 5. Smooth-scroll for anchor links (since CSS smooth scroll is off
  //    so programmatic scrolls settle cleanly).
  // ---------------------------------------------------------
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href').slice(1);
      const t = document.getElementById(id);
      if (!t) return;
      e.preventDefault();
      window.scrollTo({ top: t.offsetTop, behavior: 'smooth' });
    });
  });

  // ---------------------------------------------------------
  // 6. Render loop
  // ---------------------------------------------------------
  let last = performance.now();
  function tick() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    try {
      cube.update(dt, now / 1000);
      cube.render();
    } catch (e) {
      console.error('[scene] frame error', e);
    }
  }
  function loop() { tick(); requestAnimationFrame(loop); }
  requestAnimationFrame(loop);
  // Belt-and-braces fallback: if rAF is throttled when the iframe is unfocused,
  // a setInterval keeps things moving.
  setInterval(() => {
    if (performance.now() - last > 100) tick();
  }, 33);
})();
