/* Voice Awareness Dashboard: core
 * - widget registry (VAD.register) + layout engine (grid, drag, resize, presets)
 * - shared audio transport (seek, loop, time bus) exposed to widgets as ctx
 * - localStorage persistence for layout and per-day practice state
 * Widgets live in widgets.js; each one is { type, title, category, desc, size,
 * multi?, render(bodyEl, ctx) -> optional cleanup() }.
 */
(function () {
  'use strict';
  const LS = 'vad.';
  // Record runtime errors in the DOM so headless QA (dump-dom) can see them.
  window.addEventListener('error', (e) => { const l = document.getElementById('errlog'); if (l) l.textContent += '[err] ' + e.message + '\n'; });
  const $ = (s, r = document) => r.querySelector(s);
  const DATA = window.VOICE_DATA || { targets: {}, sessions: [] };
  const REG = {};
  const SIZES = ['S', 'M', 'L', 'XL'];

  // ---------- storage ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(LS + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch { /* quota / private mode */ } },
  };

  // ---------- helpers ----------
  const fmt = (t) => { t = Math.max(0, t || 0); return Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0'); };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const h = (tag, attrs = {}, html = '') => { const e = document.createElement(tag); for (const k in attrs) e.setAttribute(k, attrs[k]); e.innerHTML = html; return e; };
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 1800); }
  const tsBtn = (t, label) => `<button class="ts" data-seek="${+t || 0}" aria-label="Play from ${fmt(t)}">${label || fmt(t)}</button>`;

  // Activity log per day (drives streak/heatmap): {date: {ex:[ids], takes:n, journal:bool, listened:bool}}
  const activity = {
    all() { return store.get('activity', {}); },
    mark(kind, val) {
      const a = this.all(); const d = today(); a[d] = a[d] || {};
      if (kind === 'ex') { a[d].ex = Array.from(new Set([...(a[d].ex || []), val])); }
      else if (kind === 'takes') a[d].takes = (a[d].takes || 0) + 1;
      else a[d][kind] = val ?? true;
      store.set('activity', a); bus.emit('activity');
    },
    unmark(val) { const a = this.all(); const d = today(); if (a[d]?.ex) { a[d].ex = a[d].ex.filter((x) => x !== val); store.set('activity', a); bus.emit('activity'); } },
    score(d) { const x = this.all()[d]; if (!x) return 0; return (x.ex?.length || 0) + (x.takes || 0) + (x.journal ? 1 : 0) + (x.listened ? 1 : 0); },
  };

  // ---------- event bus ----------
  const bus = {
    m: {}, on(e, f) { (this.m[e] = this.m[e] || new Set()).add(f); return () => this.m[e].delete(f); },
    emit(e, v) { (this.m[e] || []).forEach((f) => { try { f(v); } catch (err) { console.error(err); } }); },
  };

  // ---------- audio transport ----------
  const audio = $('#audio');
  let loop = null; let raf = 0; let listenedMarked = false;
  function tick() {
    cancelAnimationFrame(raf);
    if (loop && audio.currentTime >= loop[1]) audio.currentTime = loop[0];
    bus.emit('time', audio.currentTime);
    paintBar();
    if (!audio.paused) raf = requestAnimationFrame(tick);
  }
  function paintBar() {
    const d = audio.duration || session()?.metrics?.duration || 1;
    $('#seekFill').style.width = (100 * audio.currentTime / d) + '%';
    $('#seekBar').setAttribute('aria-valuenow', Math.round(100 * audio.currentTime / d));
    $('#timeLbl').textContent = fmt(audio.currentTime) + ' / ' + fmt(d);
    const lm = $('#loopMark');
    if (loop) { lm.style.display = 'block'; lm.style.left = (100 * loop[0] / d) + '%'; lm.style.width = (100 * (loop[1] - loop[0]) / d) + '%'; }
    else lm.style.display = 'none';
    $('#loopOff').hidden = !loop;
  }
  function seek(t, play = true, keepLoop = false) {
    if (!keepLoop && loop) clearLoop();
    audio.currentTime = Math.max(0, t);
    if (play) audio.play().catch(() => toast('Press play to allow audio'));
    tick();
  }
  function setLoop(a, b) { const d = audio.duration || b; loop = [Math.max(0, a), Math.min(b, d)]; seek(loop[0], true, true); toast(`Looping ${fmt(loop[0])} to ${fmt(loop[1])}`); }
  function clearLoop() { loop = null; paintBar(); }
  audio.addEventListener('play', () => {
    $('#playBtn').textContent = '❚❚'; $('#playBtn').setAttribute('aria-label', 'Pause'); cancelAnimationFrame(raf); tick();
    if (!listenedMarked) { listenedMarked = true; activity.mark('listened'); }
  });
  audio.addEventListener('pause', () => { $('#playBtn').textContent = '▶'; $('#playBtn').setAttribute('aria-label', 'Play'); tick(); });
  audio.addEventListener('loadedmetadata', paintBar);
  audio.addEventListener('error', () => toast('Audio file not found for this session'));
  $('#playBtn').onclick = () => (audio.paused ? audio.play().catch(() => {}) : audio.pause());
  $('#back5').onclick = () => seek(audio.currentTime - 5, !audio.paused);
  $('#fwd5').onclick = () => seek(audio.currentTime + 5, !audio.paused);
  $('#rateSel').onchange = (e) => { audio.playbackRate = +e.target.value; };
  $('#loopOff').onclick = clearLoop;
  const bar = $('#seekBar');
  bar.onclick = (e) => { const r = bar.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * (audio.duration || 0), !audio.paused); };
  bar.onkeydown = (e) => { if (e.key === 'ArrowRight') seek(audio.currentTime + 5, !audio.paused); if (e.key === 'ArrowLeft') seek(audio.currentTime - 5, !audio.paused); };
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input,textarea,select,[contenteditable]')) return;
    if (e.code === 'Space') { e.preventDefault(); $('#playBtn').click(); }
  });
  // Any [data-seek] anywhere in the page seeks the shared audio.
  document.addEventListener('click', (e) => {
    const s = e.target.closest('[data-seek]'); if (!s) return;
    const t = +s.dataset.seek; const until = s.dataset.until;
    if (until) setLoop(t, +until); else seek(t, true);
  });

  // ---------- session ----------
  let sid = store.get('session', DATA.sessions.at(-1)?.id);
  function session() { return DATA.sessions.find((s) => s.id === sid) || DATA.sessions.at(-1); }
  function loadSession() {
    const s = session(); if (!s) return;
    sid = s.id; store.set('session', sid);
    audio.src = s.audio; loop = null;
    $('#nowTitle').textContent = s.title;
    listenedMarked = false;
    paintBar();
  }

  // ---------- canvas chart helper ----------
  // series: [{data:[[x,y],...], color, width, fill, bars}], opts: {xmax, ymin, ymax, band:[lo,hi], playhead:true, marks:[{x,color}], yfmt}
  function chart(canvas, series, opts = {}) {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 600; const H = opts.height || 160;
    canvas.style.height = H + 'px'; canvas.width = W * dpr; canvas.height = H * dpr;
    const g = canvas.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, W, H);
    const pad = { l: 34, r: 8, t: 8, b: 18 };
    const xs = series.flatMap((s) => s.data.map((p) => p[0])); const ys = series.flatMap((s) => s.data.map((p) => p[1]));
    const xmin = opts.xmin ?? 0; const xmax = opts.xmax ?? Math.max(1, ...xs);
    const ymin = opts.ymin ?? Math.min(...ys); const ymax = opts.ymax ?? Math.max(...ys);
    const X = (x) => pad.l + ((x - xmin) / (xmax - xmin || 1)) * (W - pad.l - pad.r);
    const Y = (y) => H - pad.b - ((y - ymin) / (ymax - ymin || 1)) * (H - pad.t - pad.b);
    g.font = '10px -apple-system,sans-serif'; g.fillStyle = cssVar('--muted'); g.strokeStyle = cssVar('--line'); g.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = ymin + ((ymax - ymin) * i) / 3; g.beginPath(); g.moveTo(pad.l, Y(y)); g.lineTo(W - pad.r, Y(y)); g.stroke();
      g.fillText((opts.yfmt || ((v) => Math.round(v)))(y), 2, Y(y) + 3);
    }
    const xt = opts.xticks || 6;
    const xat = opts.xat || Array.from({ length: xt + 1 }, (_, i) => xmin + ((xmax - xmin) * i) / xt);
    xat.forEach((x) => g.fillText((opts.xfmt || fmt)(x), Math.min(W - 24, Math.max(pad.l - 10, X(x) - 10)), H - 4));
    if (opts.band) {
      g.fillStyle = cssVar('--ok') + '22';
      const lo = opts.band[0] ?? ymin; const hi = opts.band[1] ?? ymax;
      g.fillRect(pad.l, Y(Math.min(hi, ymax)), W - pad.l - pad.r, Y(Math.max(lo, ymin)) - Y(Math.min(hi, ymax)));
    }
    (opts.marks || []).forEach((m) => { g.fillStyle = m.color; g.fillRect(X(m.x), pad.t, Math.max(2, X(m.x + (m.w || 0)) - X(m.x)), H - pad.t - pad.b); });
    series.forEach((s) => {
      g.strokeStyle = s.color; g.fillStyle = s.color; g.lineWidth = s.width || 1.5;
      if (s.bars) {
        const bw = Math.max(2, ((W - pad.l - pad.r) / (s.data.length || 1)) * (s.bw || 0.35));
        s.data.forEach(([x, y]) => g.fillRect(X(x) + (s.off || 0) * bw, Y(y), bw, Y(ymin) - Y(y)));
        return;
      }
      if (s.dots) { s.data.forEach(([x, y]) => { g.beginPath(); g.arc(X(x), Y(y), s.r || 1.2, 0, 7); g.fill(); }); return; }
      g.beginPath(); let pen = false;
      s.data.forEach(([x, y]) => { if (y == null) { pen = false; return; } pen ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)); pen = true; });
      g.stroke();
      if (s.points) s.data.forEach(([x, y]) => { if (y == null) return; g.beginPath(); g.arc(X(x), Y(y), 3, 0, 7); g.fill(); });
    });
    return { X, Y, W, H, pad, xmin, xmax };
  }
  // Transparent overlay canvas for a moving playhead, so charts are not redrawn at 60 fps.
  function playhead(wrap, geomRef) {
    const c = h('canvas', { 'aria-hidden': 'true' }); c.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    wrap.style.position = 'relative'; wrap.appendChild(c);
    const draw = (t) => {
      const gm = geomRef(); if (!gm) return; const dpr = window.devicePixelRatio || 1;
      if (c.width !== gm.W * dpr) { c.width = gm.W * dpr; c.height = gm.H * dpr; c.style.height = gm.H + 'px'; }
      const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, gm.W, gm.H);
      if (t < gm.xmin || t > gm.xmax) return;
      g.strokeStyle = cssVar('--coral'); g.lineWidth = 2; g.beginPath(); g.moveTo(gm.X(t), gm.pad.t); g.lineTo(gm.X(t), gm.H - gm.pad.b); g.stroke();
    };
    return bus.on('time', draw);
  }
  // Click-to-seek on a chart canvas.
  function clickSeek(canvas, geomRef) {
    canvas.style.cursor = 'pointer';
    canvas.addEventListener('click', (e) => {
      const gm = geomRef(); if (!gm) return; const r = canvas.getBoundingClientRect(); const x = e.clientX - r.left;
      const t = gm.xmin + ((x - gm.pad.l) / (gm.W - gm.pad.l - gm.pad.r)) * (gm.xmax - gm.xmin); seek(Math.max(0, t), true);
    });
  }
  // Redraw on resize; returns cleanup.
  function onResize(el, fn) { const ro = new ResizeObserver(() => fn()); ro.observe(el); return () => ro.disconnect(); }

  // ---------- layout ----------
  const PRESETS = {
    daily: { name: 'Daily review', items: [['today', 'L'], ['streak', 'S'], ['scorecard', 'XL'], ['timeline', 'XL'], ['exercises', 'L'], ['thinkfirst', 'S'], ['journal', 'M'], ['moments', 'M']] },
    deep: { name: 'Deep dive: listen + analyse', items: [['scorecard', 'XL'], ['timeline', 'XL'], ['transcript', 'L'], ['pauses', 'S'], ['pitch', 'M'], ['pace', 'M'], ['loudness', 'M'], ['endings', 'M'], ['habits', 'M'], ['moments', 'M']] },
    feedback: { name: 'Feedback + plan', items: [['today', 'XL'], ['feedback', 'XL'], ['strengths', 'M'], ['thinkfirst', 'M'], ['exercises', 'XL']] },
    practice: { name: 'Practice studio', items: [['recorder', 'L'], ['thinkfirst', 'S'], ['takes', 'M'], ['exercises', 'M'], ['journal', 'M'], ['streak', 'M']] },
    progress: { name: 'Progress over time', items: [['trends', 'XL'], ['streak', 'M'], ['takes', 'M'], ['scorecard', 'XL'], ['addsession', 'M']] },
  };
  let layout = store.get('layout', null);
  const uid = () => Math.random().toString(36).slice(2, 9);
  function applyPreset(k) { layout = PRESETS[k].items.filter(([t]) => REG[t]).map(([type, size]) => ({ uid: uid(), type, size })); saveLayout(); render(); toast('Layout: ' + PRESETS[k].name); }
  function saveLayout() { store.set('layout', layout); }
  const cleanups = new Map();

  function render() {
    const grid = $('#grid');
    cleanups.forEach((f) => f && f()); cleanups.clear();
    grid.innerHTML = '';
    if (!layout.length) { grid.innerHTML = '<div class="empty">Your dashboard is empty. Open the <b>Widget pantry</b> to add widgets, or pick a layout preset.</div>'; return; }
    layout.forEach((item, i) => grid.appendChild(frame(item, i)));
  }

  function frame(item, i) {
    const def = REG[item.type];
    const el = h('section', { class: 'w', 'data-size': item.size, 'data-uid': item.uid, 'aria-label': def ? def.title : item.type });
    if (!def) { el.innerHTML = `<div class="wb muted">Unknown widget "${esc(item.type)}". <button class="btn sm" data-wact="rm">Remove</button></div>`; bindFrame(el, item); return el; }
    el.innerHTML = `<div class="wh">
      <button class="handle" draggable="true" aria-label="Drag to move ${esc(def.title)}" title="Drag to move">⠿</button>
      <h2>${esc(def.title)}</h2><span class="cat">${esc(def.category)}</span>
      <button class="iconbtn" data-wact="up" aria-label="Move earlier" title="Move earlier">↑</button>
      <button class="iconbtn" data-wact="down" aria-label="Move later" title="Move later">↓</button>
      <button class="iconbtn" data-wact="size" aria-label="Change width (now ${item.size})" title="Width: ${item.size}">${item.size}</button>
      <button class="iconbtn" data-wact="rm" aria-label="Remove ${esc(def.title)}" title="Remove">✕</button></div><div class="wb"></div>`;
    bindFrame(el, item);
    const body = $('.wb', el);
    const s = session();
    if (def.needsSession !== false && !s) body.innerHTML = '<p class="muted">No session data yet. Run analyze.py to add one.</p>';
    else {
      try { cleanups.set(item.uid, def.render(body, ctx(item))); }
      catch (err) { console.error(err); body.innerHTML = `<p class="muted">This widget failed to render: ${esc(err.message)}</p>`; }
    }
    return el;
  }

  function bindFrame(el, item) {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-wact]'); if (!b || !el.contains(b)) return;
      const i = layout.findIndex((x) => x.uid === item.uid);
      if (b.dataset.wact === 'rm') { layout.splice(i, 1); toast('Removed. Add it back from the pantry.'); }
      if (b.dataset.wact === 'up' && i > 0) [layout[i - 1], layout[i]] = [layout[i], layout[i - 1]];
      if (b.dataset.wact === 'down' && i < layout.length - 1) [layout[i + 1], layout[i]] = [layout[i], layout[i + 1]];
      if (b.dataset.wact === 'size') item.size = SIZES[(SIZES.indexOf(item.size) + 1) % SIZES.length];
      saveLayout(); render();
      const again = document.querySelector(`[data-uid="${item.uid}"] [data-wact="${b.dataset.wact}"]`); if (again) again.focus();
    });
    const handle = $('.handle', el);
    if (handle) {
      handle.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-vad-uid', item.uid); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
      handle.addEventListener('dragend', () => el.classList.remove('dragging'));
    }
    el.addEventListener('dragover', (e) => { if (!e.dataTransfer.types.includes('application/x-vad-uid')) return; e.preventDefault(); el.classList.add('drop-before'); });
    el.addEventListener('dragleave', () => el.classList.remove('drop-before'));
    el.addEventListener('drop', (e) => {
      e.preventDefault(); el.classList.remove('drop-before');
      const from = e.dataTransfer.getData('application/x-vad-uid'); if (!from || from === item.uid) return;
      const fi = layout.findIndex((x) => x.uid === from); if (fi < 0) return; const moved = layout.splice(fi, 1)[0];
      const ti = layout.findIndex((x) => x.uid === item.uid); layout.splice(ti, 0, moved); saveLayout(); render();
    });
  }

  function ctx(item) {
    return {
      data: DATA, session: session(), sessions: DATA.sessions, targets: DATA.targets, audio, bus, store, activity,
      seek, setLoop, clearLoop, fmt, esc, h, tsBtn, chart, playhead, clickSeek, onResize, cssVar, toast, today,
      notes: session()?.notes || null, item,
      state: { get: (d) => store.get('w.' + item.uid, d), set: (v) => store.set('w.' + item.uid, v) },
    };
  }

  // ---------- pantry ----------
  function openPantry() { $('#drawer').classList.add('open'); $('#scrim').classList.add('open'); paintPantry(); $('#pantrySearch').focus(); }
  function closePantry() { $('#drawer').classList.remove('open'); $('#scrim').classList.remove('open'); $('#pantryBtn').focus(); }
  function paintPantry() {
    const q = $('#pantrySearch').value.toLowerCase();
    const cats = {};
    Object.values(REG).filter((d) => !q || (d.title + d.desc + d.category).toLowerCase().includes(q))
      .forEach((d) => (cats[d.category] = cats[d.category] || []).push(d));
    const inUse = new Set(layout.map((x) => x.type));
    $('#pantryList').innerHTML = Object.keys(cats).map((c) => `<div class="pcat">${esc(c)}</div>` + cats[c].map((d) => `
      <div class="pitem"><div style="flex:1"><div class="n">${esc(d.title)}</div><div class="dsc">${esc(d.desc)}</div>
      ${inUse.has(d.type) ? '<div class="in">✓ on dashboard</div>' : ''}</div>
      <button class="btn sm" data-add="${d.type}" ${inUse.has(d.type) && !d.multi ? 'disabled title="Already on dashboard"' : ''}>Add</button></div>`).join('')).join('')
      || '<p class="muted">No widgets match.</p>';
  }
  $('#pantryList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-add]'); if (!b || b.disabled) return;
    const d = REG[b.dataset.add]; const it = { uid: uid(), type: d.type, size: d.size || 'M' };
    layout.unshift(it); saveLayout(); render(); paintPantry(); toast(d.title + ' added at the top');
  });
  $('#pantryBtn').onclick = openPantry; $('#closePantry').onclick = closePantry; $('#scrim').onclick = closePantry;
  $('#pantrySearch').oninput = paintPantry;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#drawer').classList.contains('open')) closePantry(); });

  // ---------- "more" menu: reset / export / import ----------
  const menu = h('div', { id: 'moreMenu', role: 'menu', hidden: '' }, `
    <button role="menuitem" data-pick="1">Reset to Daily review</button>
    <button role="menuitem" data-pick="2">Export layout (copy JSON)</button>
    <button role="menuitem" data-pick="3">Import layout (paste JSON)</button>
    <button role="menuitem" data-pick="4" style="color:var(--off)">Clear my practice data…</button>`);
  document.body.appendChild(menu);
  $('#moreBtn').onclick = (e) => {
    e.stopPropagation(); const r = $('#moreBtn').getBoundingClientRect();
    menu.style.top = r.bottom + 6 + 'px'; menu.style.right = window.innerWidth - r.right + 'px';
    menu.hidden = !menu.hidden; $('#moreBtn').setAttribute('aria-expanded', String(!menu.hidden)); if (!menu.hidden) menu.querySelector('button').focus();
  };
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) menu.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') menu.hidden = true; });
  menu.onclick = (e) => {
    const b = e.target.closest('[data-pick]'); if (!b) return; menu.hidden = true; const pick = b.dataset.pick;
    if (pick === '1') applyPreset('daily');
    if (pick === '2') { const j = JSON.stringify(layout.map(({ type, size }) => ({ type, size }))); navigator.clipboard?.writeText(j); prompt('Layout JSON (copied):', j); }
    if (pick === '3') { const j = prompt('Paste layout JSON:'); try { layout = JSON.parse(j).filter((x) => REG[x.type]).map((x) => ({ uid: uid(), type: x.type, size: SIZES.includes(x.size) ? x.size : 'M' })); saveLayout(); render(); toast('Layout imported'); } catch { toast('That was not valid layout JSON'); } }
    if (pick === '4' && confirm('Delete journal entries, exercise ticks, bookmarks and practice-take metrics saved in this browser? This cannot be undone.')) {
      Object.keys(localStorage).filter((k) => k.startsWith(LS) && !/^vad\.(layout|session|theme)$/.test(k)).forEach((k) => localStorage.removeItem(k)); render(); toast('Practice data cleared');
    }
  };

  // ---------- theme ----------
  function setTheme(t) { document.documentElement.dataset.theme = t; store.set('theme', t); if (layout) render(); }
  $('#themeBtn').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

  // ---------- boot ----------
  function boot() {
    document.documentElement.dataset.theme = store.get('theme', 'dark');
    const ss = $('#sessionSel');
    ss.innerHTML = DATA.sessions.slice().reverse().map((s) => `<option value="${esc(s.id)}">${esc(s.date.slice(0, 10))} · ${esc(s.title)}</option>`).join('') || '<option>No sessions</option>';
    ss.value = session()?.id || '';
    ss.onchange = () => { sid = ss.value; loadSession(); render(); };
    const ps = $('#presetSel');
    ps.innerHTML = '<option value="">Choose preset…</option>' + Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${esc(p.name)}</option>`).join('');
    ps.onchange = () => { if (ps.value) { if (layout.length && !confirm('Replace the current layout with "' + PRESETS[ps.value].name + '"?')) { ps.value = ''; return; } applyPreset(ps.value); } ps.value = ''; };
    if (DATA.built) $('#builtAt').textContent = 'Data built ' + DATA.built.replace('T', ' ');
    loadSession();
    // ?preset=<key> applies a preset (handy for bookmarks, e.g. index.html?preset=practice)
    const qp = new URLSearchParams(location.search).get('preset');
    if (qp && PRESETS[qp]) { layout = PRESETS[qp].items.filter(([t]) => REG[t]).map(([type, size]) => ({ uid: uid(), type, size })); saveLayout(); history.replaceState(null, '', location.pathname); }
    if (Array.isArray(layout)) layout = layout.filter((x) => x && typeof x.type === 'string').map((x) => ({ uid: String(x.uid || uid()).replace(/[^\w-]/g, ''), type: x.type, size: SIZES.includes(x.size) ? x.size : 'M' }));
    if (!Array.isArray(layout)) { layout = PRESETS.daily.items.filter(([t]) => REG[t]).map(([type, size]) => ({ uid: uid(), type, size })); saveLayout(); }
    render();
  }

  window.VAD = { register: (d) => { REG[d.type] = d; }, boot, rerender: () => render(), registry: REG, presets: PRESETS };
})();
