(() => {
  // ---------- 0) URL sync plumbing ----------
  var urlSyncTimer = null;
  var initReady = false;

  function queueURLSync() {
    if (!initReady) return;
    clearTimeout(urlSyncTimer);
    urlSyncTimer = setTimeout(syncURLFromState, 200);
  }

  function syncURLFromState() {
    if (!initReady) return;

    const params = new URLSearchParams();
    // always keep theme + mode
    params.set('theme', themeSelect.value);
    params.set('mode', mode);

    switch (mode) {
      case MODES.MANUAL: {
        const p = Math.round(target);
        params.set('progress', String(p));
        if (chaotic.checked) params.set('chaotic', '1');
        break;
      }
      case MODES.COUNTDOWN: {
        if (startAt.value) params.set('start', startAt.value);
        if (endAt.value)   params.set('end', endAt.value);
        break;
      }
      case MODES.DURATION: {
        const d = parseFloat(durationSec.value);
        if (!Number.isNaN(d) && d > 0) params.set('duration', String(d));
        break;
      }
    }

    const newUrl = `${location.pathname}?${params.toString()}`;
    history.replaceState(null, '', newUrl);
    if (urlExample) urlExample.value = location.href;
  }

  // ---------- 1) Helpers ----------
  function clamp(v, min = 0, max = 100) {
    return Math.max(min, Math.min(max, v));
  }

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

  // ---------- 2) Parse QS ----------
  const qs = new URLSearchParams(location.search);
  const qsTheme   = (qs.get('theme') || 'cyan').toLowerCase();
  let qsMode      = (qs.get('mode') || '').toLowerCase();
  const qsStart   = qs.get('start');
  const qsEnd     = qs.get('end');
  const qsChaotic = qs.get('chaotic');
  const qsDuration= parseFloat(qs.get('duration'));
  const qsProgress= clamp(parseFloat(qs.get('progress')), 0, 100);

  // ---------- 3) DOM Refs ----------
  const themeNameEl = document.getElementById('themeName');
  const themeSelect = document.getElementById('themeSelect');
  const barFill     = document.getElementById('barFill');
  const barGlow     = document.getElementById('barGlow');
  const percentEl   = document.getElementById('percent');
  const marker      = document.getElementById('marker');
  const modeLabel   = document.getElementById('mode');
  const statusEl    = document.getElementById('status').querySelector('.kbd');
  const fsBtn       = document.getElementById('fsBtn');
  const cleanBtn    = document.getElementById('cleanBtn');
  const barWrap     = document.getElementById('barWrap');
  const hint        = document.getElementById('hint');

  // drawer + settings
  const drawer         = document.getElementById('drawer');
  const drawerHandle   = document.getElementById('drawerHandle');
  const modeBar        = document.getElementById('modeBar');
  const startAt        = document.getElementById('startAt');
  const endAt          = document.getElementById('endAt');
  const chaotic        = document.getElementById('chaotic');
  const durationSec    = document.getElementById('durationSec');
  const durStartBtn    = document.getElementById('durStart');
  const durResetBtn    = document.getElementById('durReset');
  const countdownFields= document.getElementById('countdownFields');
  const durationFields = document.getElementById('durationFields');
  const qStartNow      = document.getElementById('qStartNow');
  const qNowToCurrentEnd = document.getElementById('qNowToCurrentEnd');
  const urlExample     = document.getElementById('urlExample');

  // tabs & control buttons
  const tabBtnSettings = document.getElementById('tabBtnSettings');
  const tabBtnControls = document.getElementById('tabBtnControls');
  const tabSettings    = document.getElementById('tabSettings');
  const tabControls    = document.getElementById('tabControls');
  const ctrlStart      = document.getElementById('ctrlStart');
  const ctrlPause      = document.getElementById('ctrlPause');
  const ctrlStop       = document.getElementById('ctrlStop');

  // ---------- 4) Theme ----------
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t === 'cyan' ? '' : t);
    themeNameEl.textContent = t;
    themeSelect.value = t;
    queueURLSync();
  }
  if (['cyan','magenta','amber','lime','violet'].includes(qsTheme)) {
    applyTheme(qsTheme);
  } else {
    applyTheme('cyan');
  }
  themeSelect.addEventListener('change', e => applyTheme(e.target.value));

  // ---------- 5) State ----------
  const MODES = { MANUAL:'manual', COUNTDOWN:'countdown', DURATION:'duration' };
  let mode   = MODES.MANUAL;
  let progress = !Number.isNaN(qsProgress) ? qsProgress : 0;
  let target   = progress;
  let auto     = false;
  let last     = performance.now();
  let durStartTime = null;
  let nextChaosAt  = 0;

  // ---------- 6) Infer mode & apply QS ----------
  if (!['manual','countdown','duration'].includes(qsMode)) {
    if (qsStart || qsEnd) qsMode = MODES.COUNTDOWN;
    else if (!Number.isNaN(qsDuration)) qsMode = MODES.DURATION;
    else qsMode = MODES.MANUAL;
  }

  function setMode(m) {
    mode = m;
    modeLabel.textContent = 'Mode: ' + m.charAt(0).toUpperCase() + m.slice(1);
    statusEl.textContent  = auto ? 'auto' : m;
    if (countdownFields) countdownFields.style.display = (m === MODES.COUNTDOWN) ? 'block' : 'none';
    if (durationFields)  durationFields.style.display  = (m === MODES.DURATION)  ? 'block' : 'none';
    if (modeBar) {
      const r = modeBar.querySelector(`input[value="${m}"]`);
      if (r) r.checked = true;
    }
  }

  setMode(qsMode);

  if (qsStart) startAt.value = qsStart;
  if (qsEnd)   endAt.value   = qsEnd;
  if (!Number.isNaN(qsDuration)) durationSec.value = Math.max(1, qsDuration);
  if (qsChaotic === '1' || qsChaotic === 'true') chaotic.checked = true;

  if (qsMode !== MODES.MANUAL) {
    progress = 0;
    target   = 0;
  }

  // ---------- 7) Drawer & buttons ----------
  if (drawerHandle && drawer) {
    drawerHandle.addEventListener('click', () => {
      drawer.classList.toggle('open');
    });
  }

  if (fsBtn) {
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
  }

  if (cleanBtn) {
    cleanBtn.addEventListener('click', () => {
      document.body.classList.toggle('clean');
      cleanBtn.textContent = document.body.classList.contains('clean')
        ? '🧹 Show UI'
        : '🧹 Clean UI';
    });
  }

  if (modeBar) {
    modeBar.addEventListener('change', e => {
      if (e.target.name === 'mode') {
        setMode(e.target.value);
        queueURLSync();
      }
    });
  }

  [startAt, endAt, durationSec].forEach(el => {
    if (el) el.addEventListener('input', queueURLSync);
  });
  if (chaotic) {
    chaotic.addEventListener('change', queueURLSync);
  }

  if (durStartBtn) {
    durStartBtn.addEventListener('click', () => {
      durStartTime = performance.now();
      setMode(MODES.DURATION);
      queueURLSync();
    });
  }
  if (durResetBtn) {
    durResetBtn.addEventListener('click', () => {
      durStartTime = null;
      progress = 0;
      target   = 0;
      render();
      queueURLSync();
    });
  }

  if (qStartNow) {
    qStartNow.addEventListener('click', () => {
      startAt.value = toLocalISO(new Date());
      queueURLSync();
    });
  }
  if (qNowToCurrentEnd) {
    qNowToCurrentEnd.addEventListener('click', () => {
      if (endAt.value) {
        startAt.value = toLocalISO(new Date());
        queueURLSync();
      }
    });
  }

  if (countdownFields) {
    countdownFields.querySelectorAll('[data-end]').forEach(btn => {
      btn.addEventListener('click', () => {
        const secs = parseInt(btn.getAttribute('data-end'), 10);
        const base = startAt.value ? new Date(startAt.value) : new Date();
        const end  = new Date(base.getTime() + secs * 1000);
        endAt.value = toLocalISO(end);
        queueURLSync();
      });
    });
  }

  if (durationFields) {
    durationFields.querySelectorAll('[data-dur]').forEach(btn => {
      btn.addEventListener('click', () => {
        durationSec.value = btn.getAttribute('data-dur');
        queueURLSync();
      });
    });
  }

  if (barWrap) {
    barWrap.addEventListener('click', () => {
      if (mode === MODES.MANUAL) auto = !auto;
    });
  }

  // ---------- 8) Keyboard ----------
  window.addEventListener('keydown', (e) => {
    // Space = toggle auto
    if (e.code === 'Space') {
      e.preventDefault();
      auto = !auto;
      statusEl.textContent = auto ? 'auto' : mode;
      return;
    }

    // H = toggle hide UI
    if (e.key === 'h' || e.key === 'H') {
      document.body.classList.toggle('clean');
      if (cleanBtn) {
        cleanBtn.textContent = document.body.classList.contains('clean')
          ? '🧹 Show UI'
          : '🧹 Clean UI';
      }
      return;
    }

    // arrows adjust manual progress
    const step = e.shiftKey ? 5 : 1;
    if (e.key === 'ArrowRight') {
      target = clamp(target + step);
      setMode(MODES.MANUAL);
      auto = false;
      queueURLSync();
    }
    if (e.key === 'ArrowLeft') {
      target = clamp(target - step);
      setMode(MODES.MANUAL);
      auto = false;
      queueURLSync();
    }
  });

  // ---------- 9) Auto-hide floating UI (only fs + drawer) ----------
  const floats = [fsBtn, drawerHandle].filter(Boolean);
  let hideTimer;
  function showBtn() {
    floats.forEach(b => b.classList.remove('auto-hide'));
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => floats.forEach(b => b.classList.add('auto-hide')), 1800);
  }
  window.addEventListener('mousemove', showBtn);
  window.addEventListener('touchstart', showBtn, { passive: true });
  showBtn();

  // ---------- 10) URL field: click-to-copy + paste-to-apply ----------
  if (urlExample) {
    urlExample.value = location.href;

    urlExample.addEventListener('click', async () => {
      urlExample.select();
      try {
        await navigator.clipboard.writeText(location.href);
        urlExample.style.boxShadow = '0 0 0 3px rgba(0,224,255,0.25)';
        setTimeout(() => urlExample.style.boxShadow = '', 300);
      } catch {
        // fallback = selection active
      }
    });

    urlExample.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyURLString(urlExample.value.trim());
      }
    });
  }

  function applyURLString(str) {
    try {
      // Always parse against the current URL, but NEVER adopt a different pathname
      const base = location.href;
      const url  = (str.startsWith('?') || !/^https?:/i.test(str))
        ? new URL(str, base)    // query or relative
        : new URL(str, base);   // absolute, but we’ll ignore its pathname
  
      const p = url.searchParams;
  
      // --- Theme ---
      const t = (p.get('theme') || themeSelect.value).toLowerCase();
      if (['cyan','magenta','amber','lime','violet'].includes(t)) {
        applyTheme(t);
      }
  
      // --- Mode (explicit or inferred) ---
      let m = (p.get('mode') || '').toLowerCase();
      if (!['manual','countdown','duration'].includes(m)) {
        if (p.get('start') || p.get('end'))      m = MODES.COUNTDOWN;
        else if (p.has('duration'))             m = MODES.DURATION;
        else                                    m = MODES.MANUAL;
      }
      setMode(m);
  
      // --- Fields per mode ---
      if (m === MODES.MANUAL) {
        const pr = clamp(parseFloat(p.get('progress')), 0, 100);
        if (!Number.isNaN(pr)) {
          target   = pr;
          progress = pr;
          render();
        }
        chaotic.checked = (p.get('chaotic') === '1' || p.get('chaotic') === 'true');
      } else if (m === MODES.COUNTDOWN) {
        startAt.value = p.get('start') || '';
        endAt.value   = p.get('end')   || '';
        chaotic.checked = false; // irrelevant for countdown
      } else if (m === MODES.DURATION) {
        const d = parseFloat(p.get('duration'));
        if (!Number.isNaN(d) && d > 0) durationSec.value = d;
        chaotic.checked = false;
      }
  
      // --- IMPORTANT: Keep the current path, only replace the search part ---
      const newSearch = p.toString();
      const newUrl = location.pathname + (newSearch ? '?' + newSearch : '');
      history.replaceState(null, '', newUrl);
  
      if (urlExample) urlExample.value = location.href;
  
      // ensure the UI reflects new state immediately
      render();
    } catch (err) {
      console.warn('Invalid URL/query in Share field:', err);
    }
  }
  
  // ---------- 11) Progress / modes ----------
  function countdownProgress() {
    const s = startAt.value ? new Date(startAt.value) : null;
    const e = endAt.value   ? new Date(endAt.value)   : null;
    if (!s || !e || isNaN(s) || isNaN(e) || e <= s) return NaN;
    const now = new Date();
    const total    = e - s;
    const elapsed  = now - s;
    const remaining= e - now;
    const p = (elapsed / total) * 100;
    hint.textContent = remaining > 0
      ? formatRemaining(remaining) + ' remaining'
      : 'Completed';
    return p;
  }

  function durationProgress() {
    const d = Math.max(1, parseFloat(durationSec.value || '0')) * 1000;
    if (!durStartTime) return null;
    const now     = performance.now();
    const elapsed = now - durStartTime;
    const remaining = Math.max(0, d - elapsed);
    hint.textContent = formatRemaining(remaining) + ' remaining';
    return (elapsed / d) * 100;
  }

  function chaoticTick(now) {
    if (now >= nextChaosAt) {
      target = Math.random() * 100;
      nextChaosAt = now + (400 + Math.random() * 1200);
      queueURLSync();
    }
  }

  function render() {
    const p = clamp(progress, 0, 100);
    barFill.style.width = p + '%';
    barGlow.style.width = Math.max(0, p - 0.2) + '%';
    marker.style.left   = p + '%';
    percentEl.textContent = Math.round(p) + '%';
    statusEl.textContent  = auto ? 'auto' : mode;
    if (urlExample && !urlSyncTimer) urlExample.value = location.href;
  }

  // ---------- 12) Tabs + Controls ----------
  function showTab(which) {
    const isSettings = which === 'settings';
    if (tabSettings) tabSettings.style.display = isSettings ? 'block' : 'none';
    if (tabControls) tabControls.style.display = isSettings ? 'none' : 'block';

    if (tabBtnSettings) tabBtnSettings.classList.toggle('tab-active', isSettings);
    if (tabBtnControls) tabBtnControls.classList.toggle('tab-active', !isSettings);
  }

  if (tabBtnSettings && tabBtnControls) {
    tabBtnSettings.addEventListener('click', () => showTab('settings'));
    tabBtnControls.addEventListener('click', () => showTab('controls'));
  }

  function currentMode() {
    const r = modeBar.querySelector('input[name="mode"]:checked');
    return r ? r.value : 'manual';
  }

  if (ctrlStart) {
    ctrlStart.addEventListener('click', () => {
      const m = currentMode();
      if (m === 'manual') {
        auto = true;
        statusEl.textContent = 'auto';
      } else if (m === 'duration') {
        durStartTime = performance.now();
        setMode(MODES.DURATION);
      } else if (m === 'countdown') {
        if (!startAt.value) startAt.value = toLocalISO(new Date());
        if (!endAt.value) {
          const base = new Date(startAt.value);
          const end  = new Date(base.getTime() + 3600*1000);
          endAt.value = toLocalISO(end);
        }
        setMode(MODES.COUNTDOWN);
      }
      queueURLSync();
    });
  }

  if (ctrlPause) {
    ctrlPause.addEventListener('click', () => {
      const m = currentMode();
      if (m === 'manual') {
        auto = false;
      } else if (m === 'duration') {
        durStartTime = null;
      } else if (m === 'countdown') {
        const txt = percentEl.textContent.replace('%','');
        const val = clamp(parseFloat(txt) || 0);
        target   = val;
        progress = val;
        setMode(MODES.MANUAL);
      }
      queueURLSync();
    });
  }

  if (ctrlStop) {
    ctrlStop.addEventListener('click', () => {
      auto = false;
      progress = 0;
      target   = 0;
      durStartTime = null;
      setMode(MODES.MANUAL);
      render();
      queueURLSync();
    });
  }

  showTab('settings');

  // ---------- 13) Main loop ----------
  function tick(now) {
    const dt = Math.min(33, now - last) / 1000;
    last = now;

    if (mode === MODES.COUNTDOWN) {
      const p = countdownProgress();
      if (!Number.isNaN(p)) target = clamp(p);
    } else if (mode === MODES.DURATION) {
      const p = durationProgress();
      if (p != null) target = clamp(p);
    }

    if (chaotic.checked && mode !== MODES.COUNTDOWN) {
      chaoticTick(now);
    }

    const diff = target - progress;
    const k    = 10;
    const step = diff * (1 - Math.exp(-k * dt));
    progress += step;

    render();
    requestAnimationFrame(tick);
  }

  setInterval(() => {
    if (!auto || mode !== MODES.MANUAL || chaotic.checked) return;
    if (Math.abs(target - progress) < 0.5) {
      target = (target > 50) ? 0 : 100;
      queueURLSync();
    }
  }, 800);

  // ---------- 14) Public API ----------
  window.progressBar = {
    set: (v) => {
      target = clamp(v);
      auto   = false;
      setMode(MODES.MANUAL);
      queueURLSync();
    },
    get: () => target,
    play: () => { auto = true; statusEl.textContent = 'auto'; },
    pause: () => { auto = false; statusEl.textContent = mode; },
    setMode: (m) => { setMode(m); queueURLSync(); },
    startDuration: () => {
      durStartTime = performance.now();
      setMode(MODES.DURATION);
      queueURLSync();
    },
    resetDuration: () => {
      durStartTime = null;
      queueURLSync();
    },
    MODES
  };

  // ---------- 15) Init + Self-tests ----------
  setMode(mode);
  target = progress;
  render();
  requestAnimationFrame(tick);

  initReady = true;
  queueURLSync();

  (function runSelfTests(){
    try {
      console.group('%cNeo HUD — Self-tests','color:#0ff');
      console.assert(clamp(-10) === 0 && clamp(150) === 100, 'clamp bounds');

      const iso = toLocalISO(new Date());
      const timePart = iso.split('T')[1] || '';
      console.assert(timePart.includes(':'), 'toLocalISO basic shape');

      const now = new Date();
      const s   = new Date(now.getTime() - 1000*30);
      const e   = new Date(now.getTime() + 1000*90);
      startAt.value = toLocalISO(s);
      endAt.value   = toLocalISO(e);
      setMode(MODES.COUNTDOWN);
      const cp = countdownProgress();
      console.assert(!Number.isNaN(cp) && cp >= 0 && cp <= 100, 'countdown in range');

      durationSec.value = 2;
      window.progressBar.startDuration();
      setTimeout(() => {
        console.assert(window.progressBar.get() >= 0, 'duration running');
        console.groupEnd();
      }, 10);
    } catch(err) {
      console.warn('Self-tests error', err);
    }
  })();
})();
