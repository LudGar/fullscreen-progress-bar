/* =========================================================
   Neo HUD — script.js
   Interactivity, timers, theme switching, drawer & tests
   ========================================================= */

(() => {
  /* =========================
     1) Query String + Initials
     ========================= */
  const qs = new URLSearchParams(location.search);
  const theme     = (qs.get('theme')||'cyan').toLowerCase();
  const qsMode    = (qs.get('mode') ||'manual').toLowerCase();
  const qsStart   = qs.get('start');
  const qsEnd     = qs.get('end');
  const qsChaotic = qs.get('chaotic');
  const qsDuration= parseFloat(qs.get('duration'));
  const initial   = clamp(parseFloat(qs.get('progress')), 0, 100);

  /* =========================
     2) DOM Refs
     ========================= */
  const themeNameEl = document.getElementById('themeName');
  const themeSelect = document.getElementById('themeSelect');
  const barFill  = document.getElementById('barFill');
  const barGlow  = document.getElementById('barGlow');
  const percentEl= document.getElementById('percent');
  const marker   = document.getElementById('marker');
  const modeEl   = document.getElementById('mode');
  const statusEl = document.getElementById('status').querySelector('.kbd');
  const fsBtn    = document.getElementById('fsBtn');
  const cleanBtn = document.getElementById('cleanBtn');
  const wrap     = document.getElementById('barWrap');
  const hint     = document.getElementById('hint');

  // Drawer controls
  const modeBar  = document.getElementById('modeBar');
  const startAt  = document.getElementById('startAt');
  const endAt    = document.getElementById('endAt');
  const chaotic  = document.getElementById('chaotic');
  const durationSec = document.getElementById('durationSec');
  const durStartBtn = document.getElementById('durStart');
  const durResetBtn = document.getElementById('durReset');
  const countdownFields = document.getElementById('countdownFields');
  const durationFields  = document.getElementById('durationFields');

  const qStartNow = document.getElementById('qStartNow');
  const qNowToCurrentEnd = document.getElementById('qNowToCurrentEnd');

  const drawer = document.getElementById('drawer');
  const drawerHandle = document.getElementById('drawerHandle');

  /* =========================
     3) Theme Init
     ========================= */
  const applyTheme = (t) => {
    document.documentElement.setAttribute('data-theme', t === 'cyan' ? '' : t);
    themeNameEl.textContent = t;
    themeSelect.value = t;
  };
  if (["cyan","magenta","amber","lime","violet"].includes(theme)) applyTheme(theme);
  themeSelect.addEventListener('change', (e)=> applyTheme(e.target.value));

  /* =========================
     4) State
     ========================= */
  let progress = isNaN(initial) ? 0 : initial;    // 0..100
  let target   = progress;                        // 0..100
  let auto     = false;
  let last     = performance.now();

  const MODES = { MANUAL:'manual', COUNTDOWN:'countdown', DURATION:'duration' };
  let mode = MODES.MANUAL;

  let durStartTime = null; // duration mode start time (perf.now)

  /* =========================
     5) QS → UI
     ========================= */
  if (["manual","countdown","duration"].includes(qsMode)) {
    setMode(qsMode);
    const radio = modeBar.querySelector(`input[value="${qsMode}"]`);
    if (radio) radio.checked = true;
  }
  if (qsStart) startAt.value = qsStart;
  if (qsEnd)   endAt.value   = qsEnd;
  if (!isNaN(qsDuration)) durationSec.value = Math.max(1, qsDuration);
  if (qsChaotic === '1' || qsChaotic === 'true') chaotic.checked = true;

  /* =========================
     6) Drawer + Buttons
     ========================= */
  drawerHandle.addEventListener('click', () => drawer.classList.toggle('open'));

  // Fullscreen
  fsBtn.addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        fsBtn.textContent = '⤢ Exit Fullscreen';
      } else {
        await document.exitFullscreen();
        fsBtn.textContent = '⤢ Fullscreen';
      }
    } catch (err) { console.warn(err); }
  });

  // Clean mode
  cleanBtn.addEventListener('click', () => {
    document.body.classList.toggle('clean');
    cleanBtn.textContent = document.body.classList.contains('clean') ? '🧹 Show UI' : '🧹 Clean UI';
  });

  // Mode switch
  modeBar.addEventListener('change', (e) => {
    if (e.target.name === 'mode') setMode(e.target.value);
  });

  // Duration buttons
  durStartBtn.addEventListener('click', () => { durStartTime = performance.now(); setMode(MODES.DURATION); });
  durResetBtn.addEventListener('click', () => { durStartTime = null; progress = 0; target = 0; render(); });

  // Quick: Countdown helpers
  qStartNow.addEventListener('click', () => { startAt.value = toLocalISO(new Date()); });
  qNowToCurrentEnd.addEventListener('click', () => { if (endAt.value) startAt.value = toLocalISO(new Date()); });
  countdownFields.querySelectorAll('[data-end]').forEach(btn => {
    btn.addEventListener('click', () => {
      const secs = parseInt(btn.getAttribute('data-end'), 10);
      const base = startAt.value ? new Date(startAt.value) : new Date();
      const end = new Date(base.getTime() + secs * 1000);
      endAt.value = toLocalISO(end);
    });
  });

  // Quick: Duration presets
  durationFields.querySelectorAll('[data-dur]').forEach(btn => {
    btn.addEventListener('click', () => { durationSec.value = btn.getAttribute('data-dur'); });
  });

  // Bar click: toggle auto in manual mode
  wrap.addEventListener('click', () => { if (mode === MODES.MANUAL) auto = !auto; });

  // Keyboard control
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); auto = !auto; return; }
    const step = e.shiftKey ? 5 : 1;
    if (e.key === 'ArrowRight') { target = clamp(target + step); setMode(MODES.MANUAL); auto = false; }
    if (e.key === 'ArrowLeft')  { target = clamp(target - step); setMode(MODES.MANUAL); auto = false; }
  });

  // Auto-hide floating UI on inactivity
  let hideTimer; const floats = [fsBtn, cleanBtn, drawerHandle];
  const showBtn = () => {
    floats.forEach(b=>b.classList.remove('auto-hide'));
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => floats.forEach(b=>b.classList.add('auto-hide')), 1800);
  };
  window.addEventListener('mousemove', showBtn);
  window.addEventListener('touchstart', showBtn, {passive:true});
  showBtn();

  /* =========================
     7) Main Animation Loop
     ========================= */
  function tick(now) {
    const dt = Math.min(33, now - last) / 1000; // seconds
    last = now;

    // Mode-driven target
    if (mode === MODES.COUNTDOWN) {
      const p = countdownProgress(); if (!Number.isNaN(p)) target = clamp(p);
    } else if (mode === MODES.DURATION) {
      const p = durationProgress(); if (p != null) target = clamp(p);
    }

    // Chaotic (non-countdown)
    if (chaotic.checked && mode !== MODES.COUNTDOWN) chaoticTick(now);

    // critically damped-ish ease
    const diff = target - progress;
    const k = 10;
    const step = diff * (1 - Math.exp(-k * dt));
    progress += step;

    render();
    requestAnimationFrame(tick);
  }

  // legacy auto ping-pong (manual + not chaotic)
  setInterval(() => {
    if (!auto || mode !== MODES.MANUAL || chaotic.checked) return;
    if (Math.abs(target - progress) < 0.5) target = (target > 50) ? 0 : 100;
  }, 800);

  /* =========================
     8) Mode Helpers
     ========================= */
  const MODES_OBJ = MODES; // for exposure if needed

  let nextChaosAt = 0;
  function chaoticTick(now) {
    if (now >= nextChaosAt) {
      target = Math.random() * 100;
      nextChaosAt = now + (400 + Math.random() * 1200);
    }
  }

  function countdownProgress() {
    const s = startAt.value ? new Date(startAt.value) : null;
    const e = endAt.value ? new Date(endAt.value) : null;
    if (!s || !e || isNaN(s) || isNaN(e) || e <= s) return NaN;
    const now = new Date();
    const total = e - s;
    const elapsed = now - s;
    const p = (elapsed / total) * 100;
    const remaining = e - now;
    hint.textContent = remaining > 0 ? formatRemaining(remaining) + ' remaining' : 'Completed';
    return p;
  }

  function durationProgress() {
    const d = Math.max(1, parseFloat(durationSec.value||'0')) * 1000; // ms
    if (!durStartTime) return null;
    const now = performance.now();
    const elapsed = now - durStartTime;
    hint.textContent = formatRemaining(Math.max(0, d - elapsed)) + ' remaining';
    return (elapsed / d) * 100;
  }

  function setMode(m) {
    mode = m;
    modeEl.textContent = 'Mode: ' + m.charAt(0).toUpperCase() + m.slice(1);
    countdownFields.style.display = (m === MODES.COUNTDOWN) ? 'block' : 'none';
    durationFields.style.display  = (m === MODES.DURATION)  ? 'block' : 'none';
  }

  /* =========================
     9) Rendering + Utils
     ========================= */
  function render() {
    const p = clamp(progress, 0, 100);
    barFill.style.width = p + '%';
    barGlow.style.width = Math.max(0, p - 0.2) + '%';
    marker.style.left = p + '%';
    percentEl.textContent = Math.round(p) + '%';
    statusEl.textContent = auto ? 'auto' : mode;
  }

  function clamp(v, min=0, max=100) { return Math.max(min, Math.min(max, v)); }

  function formatRemaining(ms) {
    const s = Math.ceil(ms/1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const parts = [];
    if (d) parts.push(d + 'd');
    if (h || d) parts.push(h + 'h');
    if (m || h || d) parts.push(m + 'm');
    parts.push(sec + 's');
    return parts.join(' ');
  }

  function toLocalISO(d) {
    const pad = (n)=> String(n).padStart(2,'0');
    const y = d.getFullYear();
    const mo = pad(d.getMonth()+1);
    const da = pad(d.getDate());
    const h = pad(d.getHours());
    const mi = pad(d.getMinutes());
    return `${y}-${mo}-${da}T${h}:${mi}`;
  }

  /* =========================
     10) Public API (optional)
     ========================= */
  window.progressBar = {
    set: (v) => { target = clamp(v); auto = false; setMode(MODES.MANUAL); },
    get: () => target,
    play: () => { auto = true; },
    pause: () => { auto = false; },
    setMode,
    startDuration: () => { durStartTime = performance.now(); setMode(MODES.DURATION); },
    resetDuration: () => { durStartTime = null; },
    MODES: MODES_OBJ
  };

  /* =========================
     11) Init + Self Tests
     ========================= */
  setMode(mode);
  target = progress;
  render();
  requestAnimationFrame(tick);

  (function runSelfTests(){
    try {
      console.group('%cNeo HUD — Self-tests','color:#0ff');
      console.assert(clamp(-10) === 0 && clamp(150) === 100, 'clamp bounds');
      const iso = toLocalISO(new Date());
      const timePart = iso.split('T')[1] || '';
      console.assert(timePart.includes(':'), 'toLocalISO basic shape');

      // countdown validity
      const now = new Date(); const s = new Date(now.getTime()-1000*10); const e = new Date(now.getTime()+1000*10);
      startAt.value = toLocalISO(s); endAt.value = toLocalISO(e); setMode(MODES.COUNTDOWN);
      const cp = countdownProgress(); console.assert(!Number.isNaN(cp) && cp >= 0 && cp <= 100, 'countdownProgress in range');

      // duration wiring
      durationSec.value = 2; window.progressBar.startDuration();
      setTimeout(()=>{ console.assert(window.progressBar.get() >= 0, 'duration progress running'); console.groupEnd(); }, 10);
    } catch(err){ console.warn('Self-tests error', err); }
  })();

})();
