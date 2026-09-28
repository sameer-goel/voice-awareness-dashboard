/* Voice Awareness Dashboard: widget library (the "pantry").
 * To add a widget: VAD.register({ type, title, category, desc, size, render(body, c) }).
 * render may return a cleanup function (unsubscribe timers, observers, bus events).
 */
(function () {
  'use strict';
  const R = VAD.register;
  const CAT = { ov: 'Overview', listen: 'Listen', an: 'Analysis', fb: 'Feedback & plan', pr: 'Practice', pg: 'Progress' };

  const DEFAULT_EX = [
    { id: 'think3', title: '3-second think drill', minutes: 10, steps: ['Pick a prompt.', 'Stay silent 3 s and decide your LAST word.', 'Answer in one or two sentences with no stops.'], target: 'Phrases play back as unbroken chunks.' },
  ];
  const exercisesOf = (c) => (c.notes?.exercises?.length ? c.notes.exercises : DEFAULT_EX);
  const dayIndex = (n) => { const d = new Date(); return (d.getFullYear() * 400 + d.getMonth() * 31 + d.getDate()) % n; };
  const fmtVal = (k, v) => (v == null ? '–' : k === 'asr_conf' ? v.toFixed(2) : String(v));
  const targetText = (t) => ('lo' in t && 'hi' in t ? `${t.lo} to ${t.hi}` : 'lo' in t ? `≥ ${t.lo}` : `≤ ${t.hi}`) + (t.unit ? ' ' + t.unit : '');
  const minuteTicks = (dur, every) => Array.from({ length: Math.floor(dur / 60 / every) + 1 }, (_, i) => i * every * 60);
  const itemHtml = (c, x) => (typeof x === 'string' ? c.esc(x) : (x.t != null ? c.tsBtn(x.t) + ' ' : '') + c.esc(x.text));

  // ===================== OVERVIEW =====================
  R({
    type: 'today', title: "Today's focus", category: CAT.ov, size: 'L',
    desc: 'One headline to work on today plus the exercise of the day, rotating daily.',
    render(b, c) {
      const exs = exercisesOf(c); const ex = exs[dayIndex(exs.length)];
      const paint = () => {
        const done = (c.activity.all()[c.today()]?.ex || []).includes(ex.id);
        const d = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
        const s = c.session.status || {};
        const offs = Object.keys(s).filter((k) => s[k] === 'off').map((k) => c.targets[k]?.label).filter(Boolean);
        b.innerHTML = `<div class="muted small">${c.esc(d)}</div>
          <p class="big" style="margin:6px 0 12px">${c.esc(c.notes?.focus || (offs.length ? 'Work on: ' + offs[0] : 'Keep your streak going.'))}</p>
          <div class="card"><div class="row" style="justify-content:space-between"><h3 style="margin:0">Exercise of the day: ${c.esc(ex.title)}</h3>
          <span class="chip">${+ex.minutes || 5} min</span></div>
          <ol>${ex.steps.map((s) => `<li>${c.esc(s)}</li>`).join('')}</ol>
          <div class="small muted">Target: ${c.esc(ex.target || '')} ${ex.t != null ? ' · Example: ' + c.tsBtn(ex.t) : ''}</div>
          <div class="row" style="margin-top:8px"><label class="row small"><input type="checkbox" id="td-done" ${done ? 'checked' : ''}> Done today</label></div></div>
          ${offs.length ? `<div class="small muted">Off target in this session: ${offs.map((o) => `<span class="chip off">${c.esc(o)}</span>`).join(' ')}</div>` : ''}`;
        b.querySelector('#td-done').onchange = (e) => (e.target.checked ? c.activity.mark('ex', ex.id) : c.activity.unmark(ex.id));
      };
      paint(); return c.bus.on('activity', paint);
    },
  });

  R({
    type: 'scorecard', title: 'Scorecard vs targets', category: CAT.ov, size: 'XL',
    desc: 'Key delivery metrics with target ranges, colour-coded, and change since the previous session.',
    render(b, c) {
      const m = c.session.metrics; const st = c.session.status || {};
      const i = c.sessions.findIndex((s) => s.id === c.session.id); const prev = i > 0 ? c.sessions[i - 1].metrics : null;
      const cards = Object.entries(c.targets).filter(([k]) => k in m).map(([k, t]) => {
        let delta = '';
        if (prev && prev[k] != null) {
          const d = +(m[k] - prev[k]).toFixed(2);
          const better = ('hi' in t && !('lo' in t)) ? d < 0 : ('lo' in t && !('hi' in t)) ? d > 0 : Math.abs(m[k] - (t.lo + t.hi) / 2) < Math.abs(prev[k] - (t.lo + t.hi) / 2);
          delta = d === 0 ? '<div class="d muted">no change</div>' : `<div class="d" style="color:var(--${better ? 'ok' : 'off'})">${d > 0 ? '▲' : '▼'} ${Math.abs(d)} vs last</div>`;
        }
        return `<div class="kpi ${st[k] || ''}" title="${c.esc(t.label)}"><div class="l">${c.esc(t.label)}</div>
          <div class="v">${fmtVal(k, m[k])}<span class="small muted"> ${c.esc(t.unit)}</span></div>
          <div class="t">Target ${c.esc(targetText(t))}</div>${delta}</div>`;
      }).join('');
      b.innerHTML = `<div class="kpis">${cards}</div>
        <div class="legend"><span><i style="background:var(--ok)"></i>on target</span><span><i style="background:var(--near)"></i>close</span><span><i style="background:var(--off)"></i>off target</span>
        <span>Pitch median ${m.f0_median} Hz (${m.f0_p5} to ${m.f0_p95}) · ${m.words} words · ${c.fmt(m.duration)} long</span></div>`;
    },
  });

  R({
    type: 'strengths', title: 'What is already working', category: CAT.ov, size: 'M',
    desc: 'Your strengths in this recording. Keep these while fixing the rest.',
    render(b, c) {
      const s = c.notes?.strengths || [];
      b.innerHTML = s.length ? `<ul class="list">${s.map((x) => `<li><span style="color:var(--ok)">✓</span><span>${itemHtml(c, x)}</span></li>`).join('')}</ul>`
        : '<p class="muted">No curated strengths for this session yet. Ask Kiro to review it.</p>';
    },
  });

  // ===================== LISTEN =====================
  R({
    type: 'timeline', title: 'Pause timeline', category: CAT.listen, size: 'XL',
    desc: 'Loudness across the whole recording with every pause marked (red = inside a phrase). Click anywhere to listen.',
    render(b, c) {
      const s = c.session; const tr = s.tracks; const hz = tr.hz;
      b.innerHTML = `<div class="cw"><canvas aria-label="Loudness timeline with pause markers; click to seek"></canvas></div>
        <div class="legend"><span><i style="background:var(--accent2)"></i>loudness</span><span><i style="background:var(--mid)"></i>pause inside a phrase</span>
        <span><i style="background:var(--bnd)"></i>pause at a boundary</span><span><i style="background:var(--coral)"></i>playhead</span><span>Click to play from that point.</span></div>`;
      const cv = b.querySelector('canvas'); let gm = null;
      const step = Math.max(1, Math.round(tr.loud.length / 1400));
      const data = []; for (let i = 0; i < tr.loud.length; i += step) data.push([i / hz, Math.max(...tr.loud.slice(i, i + step))]);
      const draw = () => {
        gm = c.chart(cv, [{ data, color: c.cssVar('--accent2'), width: 1 }], {
          xmax: s.metrics.duration, ymin: 15, ymax: 85, height: 150, xat: minuteTicks(s.metrics.duration, 1),
          marks: s.pauses.map((p) => ({ x: p.t, w: p.len, color: (p.kind === 'mid' ? c.cssVar('--mid') : c.cssVar('--bnd')) + '99' })), yfmt: (v) => Math.round(v) + 'dB',
        });
      };
      draw(); c.clickSeek(cv, () => gm);
      const off1 = c.playhead(b.querySelector('.cw'), () => gm); const off2 = c.onResize(b, draw);
      return () => { off1(); off2(); };
    },
  });

  R({
    type: 'transcript', title: 'Synced transcript', category: CAT.listen, size: 'L',
    desc: 'Every word, highlighted as it plays. Pause badges show where you stopped; click any word to jump there.',
    render(b, c) {
      const s = c.session; const W = s.words;
      const before = new Map(); // word index -> pause
      s.pauses.forEach((p) => { const i = W.findIndex((w) => w[0] >= p.t + p.len - 0.3); if (i >= 0) before.set(i, p); });
      const rep = new Set();
      s.repeats.forEach((r) => { const i = W.findIndex((w) => Math.abs(w[0] - r.t) < 0.05); const n = r.phrase.split(' ').length * 2; for (let k = i; k >= 0 && k < i + n; k++) rep.add(k); });
      const st = c.state.get({ follow: true, minPause: 0.8 });
      const html = W.map((w, i) => {
        const p = before.get(i);
        const pz = p && p.len >= st.minPause ? `<span class="pz ${p.kind}" data-seek="${Math.max(0, p.t - 3)}" data-until="${p.t + p.len + 3}" title="${p.kind === 'mid' ? 'Pause inside a phrase' : 'Pause at a boundary'}: ${p.len}s, click to loop">‖${p.len}s</span>` : '';
        return pz + `<span class="wd${w[3] < 0.5 ? ' lowc' : ''}${rep.has(i) ? ' rep' : ''}" data-seek="${w[0]}" data-i="${i}">${c.esc(w[2])}</span>`;
      }).join(' ');
      b.innerHTML = `<div class="row small" style="margin-bottom:8px;position:sticky;top:-12px;background:var(--panel);padding:6px 0;z-index:1">
        <label class="row"><input type="checkbox" id="tx-follow" ${st.follow ? 'checked' : ''}> Follow playback</label>
        <label class="row">Show pauses ≥ <select id="tx-min" class="btn sm">${[0.8, 1, 1.5, 2, 3].map((v) => `<option ${v === st.minPause ? 'selected' : ''}>${v}</option>`).join('')}</select> s</label>
        <span class="legend" style="margin:0"><span class="pz mid" style="padding:0 4px">‖ mid</span><span class="pz boundary" style="padding:0 4px">‖ boundary</span>
        <span style="text-decoration:underline wavy var(--near)">doubled</span><span style="text-decoration:underline dotted">unclear</span></span></div>
        <div class="tx">${html}</div>`;
      b.querySelector('#tx-follow').onchange = (e) => { st.follow = e.target.checked; c.state.set(st); };
      b.querySelector('#tx-min').onchange = (e) => { st.minPause = +e.target.value; c.state.set(st); VAD.rerender(); };
      const spans = b.querySelectorAll('.wd'); let cur = -1;
      const off = c.bus.on('time', (t) => {
        let lo = 0, hi = W.length - 1, i = -1;
        while (lo <= hi) { const m = (lo + hi) >> 1; if (W[m][0] <= t) { i = m; lo = m + 1; } else hi = m - 1; }
        if (i === cur) return; if (cur >= 0) spans[cur]?.classList.remove('now'); cur = i;
        if (i >= 0 && t <= W[i][1] + 0.6) {
          spans[i].classList.add('now');
          if (st.follow) { const top = spans[i].offsetTop - b.offsetTop; if (top < b.scrollTop + 40 || top > b.scrollTop + b.clientHeight - 60) b.scrollTop = top - 120; }
        }
      });
      return off;
    },
  });

  R({
    type: 'moments', title: 'Key moments & bookmarks', category: CAT.listen, size: 'M',
    desc: 'Curated moments to re-listen to, plus your own bookmarks with notes. Loop any moment.',
    render(b, c) {
      const key = 'bm.' + c.session.id;
      const paint = () => {
        const bm = c.store.get(key, []);
        const cur = (c.notes?.observable || []).filter((x) => x.t != null);
        const row = (t, text, i) => `<li>${c.tsBtn(t)}<span style="flex:1">${c.esc(text)}</span>
          <button class="btn sm" data-seek="${Math.max(0, t - 2)}" data-until="${t + 8}" title="Loop 10 s">⟲ loop</button>${i != null ? `<button class="iconbtn" data-del="${i}" aria-label="Delete bookmark">✕</button>` : ''}</li>`;
        b.innerHTML = `<div class="row" style="margin-bottom:8px"><input type="text" id="bm-note" placeholder="Note for a bookmark at the current time…" style="flex:1" aria-label="Bookmark note">
          <button class="btn sm primary" id="bm-add">＋ Bookmark now</button></div>
          ${bm.length ? `<div class="pcat">Your bookmarks</div><ul class="list">${bm.map((x, i) => row(x.t, x.note || '(no note)', i)).join('')}</ul>` : ''}
          ${cur.length ? `<div class="pcat">Curated moments</div><ul class="list">${cur.map((x) => row(x.t, x.text)).join('')}</ul>` : ''}`;
        b.querySelector('#bm-add').onclick = () => { const l = c.store.get(key, []); l.push({ t: +c.audio.currentTime.toFixed(1), note: b.querySelector('#bm-note').value.trim() }); l.sort((a, z) => a.t - z.t); c.store.set(key, l); c.toast('Bookmarked ' + c.fmt(c.audio.currentTime)); paint(); };
        b.querySelectorAll('[data-del]').forEach((x) => (x.onclick = () => { const l = c.store.get(key, []); l.splice(+x.dataset.del, 1); c.store.set(key, l); paint(); }));
      };
      paint();
    },
  });

  // ===================== ANALYSIS =====================
  R({
    type: 'pauses', title: 'Pause inspector', category: CAT.an, size: 'S',
    desc: 'Every pause of 0.8 s or longer with the words either side. Loop each one to hear it.',
    render(b, c) {
      const P = c.session.pauses; const st = c.state.get({ f: 'mid', sort: 'len' });
      const paint = () => {
        let L = P.filter((p) => st.f === 'all' || p.kind === st.f);
        L = L.slice().sort((a, z) => (st.sort === 'len' ? z.len - a.len : a.t - z.t));
        const mids = P.filter((p) => p.kind === 'mid').length;
        b.innerHTML = `<p class="small" style="margin-top:0"><b style="color:var(--mid)">${mids}</b> of ${P.length} pauses are inside a phrase (${c.session.metrics.mid_clause_pct}%).</p>
          <div class="tabs">${[['mid', 'Inside phrase'], ['boundary', 'Boundary'], ['all', 'All']].map(([k, l]) => `<button aria-pressed="${st.f === k}" data-f="${k}">${l}</button>`).join('')}
          <button data-sort aria-pressed="false">Sort: ${st.sort === 'len' ? 'longest' : 'time'}</button></div>
          <ul class="list">${L.map((p) => `<li style="flex-direction:column;gap:2px"><div class="row">${c.tsBtn(p.t)}<span class="chip ${p.kind === 'mid' ? 'off' : ''}">${p.len}s</span>
            <button class="btn sm" data-seek="${Math.max(0, p.t - 3)}" data-until="${p.t + p.len + 2.5}">⟲ loop</button></div>
            <div class="small">…${c.esc(p.prev)} <b style="color:var(--${p.kind === 'mid' ? 'mid' : 'muted'})">‖</b> ${c.esc(p.next)}…</div></li>`).join('')}</ul>`;
        b.querySelectorAll('[data-f]').forEach((x) => (x.onclick = () => { st.f = x.dataset.f; c.state.set(st); paint(); }));
        b.querySelector('[data-sort]').onclick = () => { st.sort = st.sort === 'len' ? 'time' : 'len'; c.state.set(st); paint(); };
      };
      paint();
    },
  });

  R({
    type: 'pitch', title: 'Pitch & melody', category: CAT.an, size: 'M',
    desc: 'Your pitch contour over time and how much it varies in each 30-second window (target ≥ 3 semitones).',
    render(b, c) {
      const s = c.session; const tr = s.tracks; const med = s.metrics.f0_median;
      b.innerHTML = `<div class="cw"><canvas aria-label="Pitch contour"></canvas></div><div class="small muted" style="margin:10px 0 4px">Pitch variation per 30 s (semitones). Green band = target.</div>
        <canvas aria-label="Pitch variation per 30 seconds"></canvas>
        <div class="legend"><span>Median ${med} Hz · span ${s.metrics.f0_range_st} st · variation ${s.metrics.f0_sd_st} st</span></div>`;
      const [cv, cv2] = b.querySelectorAll('canvas'); let gm = null;
      const pts = []; tr.pitch.forEach((f, i) => { if (f > 0 && f < med * 2.2 && f > med / 2) pts.push([i / tr.hz, f]); });
      const draw = () => {
        gm = c.chart(cv, [{ data: pts, color: c.cssVar('--accent'), dots: true, r: 0.9 }], { xmax: s.metrics.duration, ymin: Math.round(med * 0.7), ymax: Math.round(med * 1.6), height: 150, xat: minuteTicks(s.metrics.duration, 2), yfmt: (v) => Math.round(v) + 'Hz' });
        c.chart(cv2, [{ data: s.windows.map((w) => [w.t / 60, w.sd_st]), color: c.cssVar('--accent2'), bars: true, bw: 0.7 }], { xmin: 0, xmax: s.metrics.duration / 60, ymin: 0, ymax: 4, band: [3, 4], height: 90, xat: Array.from({ length: Math.floor(s.metrics.duration / 60) + 1 }, (_, i) => i), xfmt: (m) => m + 'm', yfmt: (v) => v.toFixed(1) });
      };
      draw(); c.clickSeek(cv, () => gm);
      const o1 = c.playhead(b.querySelector('.cw'), () => gm); const o2 = c.onResize(b, draw);
      return () => { o1(); o2(); };
    },
  });

  R({
    type: 'loudness', title: 'Volume & steadiness', category: CAT.an, size: 'M',
    desc: 'Peak speech level in each 30-second window. Flat = steady projection; dips show where energy drops.',
    render(b, c) {
      const s = c.session;
      b.innerHTML = `<canvas aria-label="Peak loudness per 30 seconds"></canvas><p class="small muted">Level spread across windows: <b>${s.metrics.level_p90_sd} dB</b> (under 2 dB is very steady). Levels are relative, not calibrated.</p>`;
      const cv = b.querySelector('canvas');
      const draw = () => c.chart(cv, [{ data: s.windows.map((w) => [w.t, w.db90]), color: c.cssVar('--coral'), points: true }], { xmax: s.metrics.duration, ymin: 55, ymax: 80, height: 140, xat: minuteTicks(s.metrics.duration, 2), yfmt: (v) => Math.round(v) + 'dB' });
      draw(); return c.onResize(b, draw);
    },
  });

  R({
    type: 'pace', title: 'Pace per minute', category: CAT.an, size: 'M',
    desc: 'Words per minute, overall (teal) and excluding pauses (blue). Green band = overall pace target.',
    render(b, c) {
      const s = c.session; const t = c.targets.wpm_gross;
      b.innerHTML = `<canvas aria-label="Words per minute by minute"></canvas>
        <div class="legend"><span><i style="background:var(--accent)"></i>overall wpm</span><span><i style="background:var(--accent2)"></i>speaking wpm (no pauses)</span><span>Click a bar to hear that minute.</span></div>
        <ul class="list small">${s.perMinute.map((p) => `<li>${c.tsBtn(p.m * 60, 'min ' + p.m)}<span>${p.wpm} overall · ${p.artic} speaking</span></li>`).join('')}</ul>`;
      const cv = b.querySelector('canvas'); let gm;
      const n = Math.max(1, ...s.perMinute.map((p) => p.m + 1));
      const draw = () => {
        gm = c.chart(cv, [
          { data: s.perMinute.map((p) => [p.m, p.wpm]), color: c.cssVar('--accent'), bars: true, bw: 0.35, off: -1 },
          { data: s.perMinute.map((p) => [p.m, p.artic]), color: c.cssVar('--accent2'), bars: true, bw: 0.35, off: 0 },
        ], { xmin: -0.5, xmax: n - 0.5, ymin: 0, ymax: 200, band: [t.lo, t.hi], height: 160, xat: s.perMinute.map((p) => p.m), xfmt: (m) => m + 'm' });
      };
      draw(); cv.addEventListener('click', (e) => { const r = cv.getBoundingClientRect(); const x = e.clientX - r.left; const m = Math.round(gm.xmin + ((x - gm.pad.l) / (gm.W - gm.pad.l - gm.pad.r)) * (gm.xmax - gm.xmin)); c.seek(Math.max(0, m * 60)); });
      cv.style.cursor = 'pointer'; return c.onResize(b, draw);
    },
  });

  R({
    type: 'endings', title: 'Sentence endings', category: CAT.an, size: 'M',
    desc: 'Do your statements land (fall) or float up (rise)? Listen to each ending.',
    render(b, c) {
      const E = c.session.endings; const st = c.state.get({ f: 'rise' });
      const cnt = (k) => E.filter((e) => e.kind === k).length;
      const paint = () => {
        b.innerHTML = `<div class="row" style="margin-bottom:8px"><span class="chip ok">↘ fall ${cnt('fall')}</span><span class="chip">→ flat ${cnt('flat')}</span><span class="chip near">↗ rise ${cnt('rise')}</span></div>
          <div class="tabs">${[['rise', 'Rising'], ['fall', 'Falling'], ['flat', 'Flat']].map(([k, l]) => `<button aria-pressed="${st.f === k}" data-f="${k}">${l}</button>`).join('')}</div>
          <ul class="list small">${E.filter((e) => e.kind === st.f).map((e) => `<li>${c.tsBtn(e.t)}<span style="flex:1">…${c.esc(e.text)}</span><span class="chip">${e.slope > 0 ? '+' : ''}${e.slope} st</span>
          <button class="btn sm" data-seek="${Math.max(0, e.t - 2.5)}" data-until="${e.t + 0.8}" aria-label="Loop this ending" title="Loop this ending">⟲</button></li>`).join('') || '<li class="muted">None.</li>'}</ul>
          <p class="tiny muted">Pitch slope over the last 0.35 s before a pause. Values beyond ±15 st are dropped as tracking errors; confirm by ear.</p>`;
        b.querySelectorAll('[data-f]').forEach((x) => (x.onclick = () => { st.f = x.dataset.f; c.state.set(st); paint(); }));
      };
      paint();
    },
  });

  R({
    type: 'habits', title: 'Verbal habits', category: CAT.an, size: 'M',
    desc: 'Filler sounds, habit phrases, doubled phrases and how you start sentences.',
    render(b, c) {
      const s = c.session;
      const hab = Object.entries(s.habits).sort((a, z) => z[1] - a[1]);
      b.innerHTML = `<div class="kpis" style="margin-bottom:10px">
          <div class="kpi ${s.status?.fillers_per_min || ''}"><div class="l">Um / uh</div><div class="v">${s.fillers.length}</div><div class="t">${s.metrics.fillers_per_min}/min</div></div>
          <div class="kpi ${s.status?.repeats || ''}"><div class="l">Doubled phrases</div><div class="v">${s.repeats.length}</div><div class="t">target ≤ ${c.targets.repeats.hi}</div></div></div>
        ${s.repeats.length ? `<div class="pcat">Doubled phrases</div><ul class="list small">${s.repeats.map((r) => `<li>${c.tsBtn(r.t)}<span>"${c.esc(r.phrase.replace(/[,.;:!?]+$/, ''))}, ${c.esc(r.phrase.replace(/[,.;:!?]+$/, ''))}"</span></li>`).join('')}</ul>` : ''}
        ${hab.length ? `<div class="pcat">Habit phrases</div><div class="row">${hab.map(([k, v]) => `<span class="chip">${c.esc(k)} × ${v}</span>`).join('')}</div>` : ''}
        <div class="pcat">Most common sentence starters</div><div class="row">${s.openers.map(([w, n]) => `<span class="chip">${c.esc(w || '…')} × ${n}</span>`).join('')}</div>
        <p class="tiny muted">The transcriber can drop um/uh; the pipeline cross-checks voiced sound between words, so a low count here is reliable.</p>`;
    },
  });

  // ===================== FEEDBACK & PLAN =====================
  R({
    type: 'feedback', title: 'Feedback: observed · interpreted · unknown', category: CAT.fb, size: 'XL',
    desc: 'The three-way split: what is measurable, what it likely means, and what one recording cannot tell.',
    render(b, c) {
      const src = c.notes || c.session.auto; const cur = !!c.notes;
      const col = (title, color, arr) => `<div class="col"><h3 style="color:var(--${color})">${title}</h3><ul class="list small">${(arr || []).map((x) => `<li><span>${itemHtml(c, x)}</span></li>`).join('')}</ul></div>`;
      b.innerHTML = `<p class="tiny muted" style="margin-top:0">${cur ? 'Curated review' : 'Auto-generated from measurements. Ask Kiro for a curated review of this session.'}</p>
        <div class="cols3">${col('1 · Clearly observable', 'accent', src.observable)}${col('2 · Reasonable interpretation', 'near', src.interpretation)}${col('3 · Cannot conclude', 'muted', src.unknown)}</div>`;
    },
  });

  R({
    type: 'exercises', title: 'Exercises & daily checklist', category: CAT.fb, size: 'L',
    desc: 'Tailored exercises with steps, a built-in timer and a done-today tick that feeds your streak.',
    render(b, c) {
      const exs = exercisesOf(c); let timer = 0;
      const paint = () => {
        const done = c.activity.all()[c.today()]?.ex || [];
        b.innerHTML = `<p class="small muted" style="margin-top:0">${done.length} of ${exs.length} done today.</p>` + exs.map((e) => {
          const m = e.metric && c.session.metrics[e.metric]; const t = e.metric && c.targets[e.metric];
          return `<div class="card ${done.includes(e.id) ? 'done' : ''}"><div class="row" style="justify-content:space-between">
            <h3 style="margin:0">${done.includes(e.id) ? '✓ ' : ''}${c.esc(e.title)}</h3>
            <div class="row"><span class="chip">${+e.minutes || 5} min</span><button class="btn sm" data-timer="${c.esc(e.id)}" data-min="${+e.minutes || 5}">⏱ Start</button>
            <label class="row small"><input type="checkbox" data-ex="${c.esc(e.id)}" ${done.includes(e.id) ? 'checked' : ''}> done</label></div></div>
            <ol class="small">${e.steps.map((s) => `<li>${c.esc(s)}</li>`).join('')}</ol>
            <div class="tiny muted">Target: ${c.esc(e.target || '')}${m != null && t ? ` · Now: <b>${fmtVal(e.metric, m)} ${c.esc(t.unit)}</b> (${c.esc(t.label)})` : ''}${e.t != null ? ' · Example ' + c.tsBtn(e.t) : ''}</div></div>`;
        }).join('');
        b.querySelectorAll('[data-ex]').forEach((x) => (x.onchange = () => (x.checked ? c.activity.mark('ex', x.dataset.ex) : c.activity.unmark(x.dataset.ex))));
        b.querySelectorAll('[data-timer]').forEach((x) => (x.onclick = () => {
          clearInterval(timer); let left = +x.dataset.min * 60; const id = x.dataset.timer;
          const tickT = () => { const el = [...b.querySelectorAll('[data-timer]')].find((z) => z.dataset.timer === id); if (!el) return clearInterval(timer); el.textContent = '⏱ ' + c.fmt(left);
            if (left-- <= 0) { clearInterval(timer); el.textContent = '✓ Time'; c.toast('Time is up. Tick it done if you finished.'); } };
          tickT(); timer = setInterval(tickT, 1000);
        }));
      };
      paint(); const off = c.bus.on('activity', paint);
      return () => { off(); clearInterval(timer); };
    },
  });

  R({
    type: 'thinkfirst', title: 'Think before the sentence', category: CAT.fb, size: 'S',
    desc: 'Six techniques to plan the whole sentence before you start it, so pauses land at boundaries.',
    needsSession: false,
    render(b, c) {
      const T = c.notes?.thinkFirst || [
        { title: 'Know the last word first', text: 'Picture the word the sentence ends on before you speak.' },
        { title: 'Pause, see it, say it', text: 'At each full stop: breathe, see the whole sentence, say it in one go.' },
      ];
      b.innerHTML = T.map((x, i) => `<div class="card"><h3>${i + 1}. ${c.esc(x.title)}</h3><div class="small">${c.esc(x.text)}</div></div>`).join('');
    },
  });

  // ===================== PRACTICE =====================
  const PROMPTS = [
    'What is the difference between automating and augmenting with AI?',
    'Why does trust matter when you work with AI systems?',
    'Explain a system prompt to someone who has never used AI.',
    'What does being accountable for AI output mean to you?',
    'Describe one task you would never fully automate, and why.',
    'What do interviewers really check for in the age of AI?',
    'Explain short-term versus long-term memory in an AI assistant.',
    'How would you show a client that an AI answer can be trusted?',
    'Give one piece of advice to someone starting an AI career.',
    'Summarise the four doors in under thirty seconds.',
  ];

  // Browser-side quick analysis of a take: pauses, speaking %, pitch variation.
  async function quickAnalyze(blob) {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const buf = await ac.decodeAudioData(await blob.arrayBuffer()); ac.close();
    const src = buf.getChannelData(0); const dsf = Math.max(1, Math.round(buf.sampleRate / 8000)); const sr = buf.sampleRate / dsf;
    const x = new Float32Array(Math.floor(src.length / dsf)); for (let i = 0; i < x.length; i++) x[i] = src[i * dsf];
    const hop = Math.round(sr * 0.02); const win = Math.round(sr * 0.04); const db = []; const f0 = [];
    const minLag = Math.floor(sr / 400); const maxLag = Math.ceil(sr / 65);
    for (let s = 0; s + win + maxLag < x.length; s += hop) {
      let e = 0; for (let i = 0; i < win; i++) e += x[s + i] * x[s + i];
      const d = 10 * Math.log10(e / win + 1e-10); db.push(d);
      let best = 0, bl = 0; const e0 = e;
      if (d > -45) {
        const nc = new Float32Array(maxLag + 1);
        for (let L = minLag; L <= maxLag; L++) { let r = 0, e1 = 0; for (let i = 0; i < win; i++) { r += x[s + i] * x[s + i + L]; e1 += x[s + i + L] * x[s + i + L]; } nc[L] = r / Math.sqrt(e0 * e1 + 1e-12); if (nc[L] > best) best = nc[L]; }
        // first local peak within 90% of the best: avoids picking 2T (octave-down)
        for (let L = minLag + 1; L < maxLag; L++) { if (nc[L] >= 0.9 * best && nc[L] >= nc[L - 1] && nc[L] >= nc[L + 1]) { bl = L; best = nc[L]; break; } }
      }
      f0.push(best > 0.6 && bl ? sr / bl : 0);
    }
    // same floor-relative rule as analyze.py: noise floor + 15% of the speech range
    const sorted = db.slice().sort((a, z) => a - z); const q = (p) => sorted[Math.floor((sorted.length - 1) * p)] ?? -60;
    const thr = q(0.1) + 0.15 * (q(0.9) - q(0.1));
    const active = db.map((d) => d > thr);
    const first = active.indexOf(true); const last = active.lastIndexOf(true);
    const pauses = []; let run = 0;
    for (let i = Math.max(0, first); i <= last; i++) { if (!active[i]) run++; else { if (run * 0.02 >= 0.8) pauses.push(+(run * 0.02).toFixed(1)); run = 0; } }
    const v = f0.filter((f) => f > 0); const vs = v.slice().sort((a, z) => a - z); const fm = vs[Math.floor(vs.length / 2)] || 0;
    const st = v.filter((f) => f > fm / 2 && f < fm * 2).map((f) => 12 * Math.log2(f / fm));
    const mean = st.reduce((a, z) => a + z, 0) / (st.length || 1);
    const sd = Math.sqrt(st.reduce((a, z) => a + (z - mean) ** 2, 0) / (st.length || 1));
    const span = first >= 0 ? (last - first) * 0.02 : 0;
    return { dur: +(buf.duration).toFixed(1), span: +span.toFixed(1), speakPct: Math.round(100 * active.slice(first, last + 1).filter(Boolean).length / Math.max(1, last - first + 1)),
      pauses08: pauses.length, pauses2: pauses.filter((p) => p >= 2).length, longest: pauses.length ? Math.max(...pauses) : 0, f0med: Math.round(fm), pitchSd: +sd.toFixed(2) };
  }

  VAD.quickAnalyze = quickAnalyze; // exposed for QA

  R({
    type: 'recorder', title: 'Practice studio', category: CAT.pr, size: 'L', needsSession: false,
    desc: 'Get a prompt, think for 3 seconds, record your answer, then see pauses and pitch variation instantly.',
    render(b, c) {
      let stream, rec, chunks = [], an, raf, t0, url, pi = Math.floor(Math.random() * PROMPTS.length), cd, disposed = false;
      b.innerHTML = `<div class="card"><div class="small muted">Prompt</div><p class="big" id="pr-q" style="margin:4px 0 8px"></p>
          <div class="row"><button class="btn sm" id="pr-next">↻ New prompt</button><span class="small muted">Rule: decide your LAST word before you start.</span></div></div>
        <div class="row" style="margin-bottom:10px"><button class="btn primary" id="pr-go">● Think 3 s, then record</button><button class="btn" id="pr-stop" disabled>■ Stop</button>
          <span id="pr-status" class="small muted" aria-live="polite">Ready.</span></div>
        <div class="row small" style="margin-bottom:6px"><span style="width:60px">Level</span><div class="meter" style="flex:1"><div id="pr-lvl"></div></div></div>
        <div class="row small"><span style="width:60px">Silence</span><b id="pr-sil" style="font-variant-numeric:tabular-nums">0.0 s</b><span class="muted">Long silence mid-sentence turns this red.</span></div>
        <div id="pr-out" style="margin-top:12px"></div>`;
      const q = b.querySelector('#pr-q'); const status = b.querySelector('#pr-status');
      const setQ = () => { q.textContent = PROMPTS[pi % PROMPTS.length]; }; setQ();
      b.querySelector('#pr-next').onclick = () => { pi++; setQ(); };
      const stopAll = () => { cancelAnimationFrame(raf); clearInterval(cd); stream?.getTracks().forEach((t) => t.stop()); stream = null; };
      b.querySelector('#pr-go').onclick = async () => {
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); }
        catch (e) { status.textContent = 'Microphone blocked: ' + e.message + '. Open the dashboard via http://localhost (not file://) and allow the mic.'; return; }
        b.querySelector('#pr-go').disabled = true; let n = 3; status.textContent = 'Think… 3';
        cd = setInterval(() => { n--; if (n > 0) { status.textContent = 'Think… ' + n; return; } clearInterval(cd); start(); }, 1000);
      };
      function start() {
        chunks = []; rec = new MediaRecorder(stream); rec.ondataavailable = (e) => chunks.push(e.data); rec.onstop = done; rec.start();
        const ac = new AudioContext(); const srcN = ac.createMediaStreamSource(stream); an = ac.createAnalyser(); an.fftSize = 2048; srcN.connect(an);
        const buf = new Float32Array(an.fftSize); t0 = performance.now(); let silStart = null; let spoke = false;
        b.querySelector('#pr-stop').disabled = false;
        const loop = () => {
          an.getFloatTimeDomainData(buf); let e = 0; for (const v of buf) e += v * v; const d = 10 * Math.log10(e / buf.length + 1e-10);
          b.querySelector('#pr-lvl').style.width = Math.max(0, Math.min(100, (d + 60) * 1.8)) + '%';
          const now = performance.now(); if (d > -42) { spoke = true; silStart = null; } else if (spoke && silStart == null) silStart = now;
          const sil = silStart ? (now - silStart) / 1000 : 0; const el = b.querySelector('#pr-sil');
          el.textContent = sil.toFixed(1) + ' s'; el.style.color = sil > 2 ? 'var(--off)' : sil > 1 ? 'var(--near)' : '';
          status.textContent = '● Recording ' + c.fmt((now - t0) / 1000) + (now - t0 > 300000 ? ' (5 min max)' : '');
          if (now - t0 > 300000) { b.querySelector('#pr-stop').click(); return; }
          raf = requestAnimationFrame(loop);
        };
        loop(); b._ac = ac;
      }
      b.querySelector('#pr-stop').onclick = () => { if (rec && rec.state === 'recording') rec.stop(); b.querySelector('#pr-stop').disabled = true; };
      async function done() {
        if (disposed) return;
        stopAll(); b._ac?.close(); b.querySelector('#pr-go').disabled = false; status.textContent = 'Analysing…';
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' }); if (url) URL.revokeObjectURL(url); url = URL.createObjectURL(blob);
        let r; try { r = await quickAnalyze(blob); } catch (e) { status.textContent = 'Could not analyse: ' + e.message; return; }
        const takes = c.store.get('takes', []); const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        takes.push({ date: new Date().toISOString(), prompt: q.textContent, ...r }); c.store.set('takes', takes); c.activity.mark('takes'); c.bus.emit('takes');
        const ext = (blob.type.includes('mp4') ? 'm4a' : 'webm');
        const kpi = (l, v, cls, t) => `<div class="kpi ${cls}"><div class="l">${l}</div><div class="v">${v}</div><div class="t">${t}</div></div>`;
        b.querySelector('#pr-out').innerHTML = `<audio controls src="${url}" style="width:100%"></audio>
          <div class="kpis" style="margin-top:8px">
            ${kpi('Pauses ≥ 0.8 s', r.pauses08, '', 'where did they fall? listen back')}
            ${kpi('Silences ≥ 2 s', r.pauses2, r.pauses2 ? 'near' : 'ok', 'aim for 0 in a short answer')}
            ${kpi('Longest silence', r.longest + ' s', r.longest > 2 ? 'off' : r.longest > 1.5 ? 'near' : 'ok', 'under 1.5 s')}
            ${kpi('Pitch variation', r.pitchSd + ' st', r.pitchSd >= 3 ? 'ok' : r.pitchSd >= 2.5 ? 'near' : 'off', 'target ≥ 3 st')}
            ${kpi('Speaking time', r.speakPct + '%', '', 'of the answer span')}</div>
          <p class="small">Saved to your practice history. For the full analysis (mid-phrase pauses, endings, words):
          <a download="take-${stamp}.${ext}" href="${url}">download this take</a>, then run:</p>
          <pre class="cmd">cd ~/voice-analysis/dashboard && uv run analyze.py ~/Downloads/take-${stamp}.${ext} --title "Practice: ${c.esc(q.textContent.slice(0, 40))}"</pre>`;
        status.textContent = 'Done. Listen back: did every pause land at a full stop?';
      }
      return () => { disposed = true; if (rec) rec.onstop = null; if (rec && rec.state === 'recording') rec.stop(); stopAll(); b._ac?.close(); if (url) URL.revokeObjectURL(url); };
    },
  });

  R({
    type: 'pacecheck', title: 'Pace check (read-aloud)', category: CAT.pr, size: 'M', needsSession: false,
    desc: 'Read a short passage in your own words at a timed pace; get your words per minute instantly.',
    render(b, c) {
      const PASS = [
        'First, I check knowledge. Do you know what to automate and what to augment? Some tasks are repeatable. They need no judgement. Automate those. Other tasks need your thinking. Brainstorm them with AI. That is augmentation. You stay in charge. The AI makes your idea stronger.',
        'Second, I check communication. Can you talk to AI well? Do you know what a system prompt is? It is what the AI always remembers. Do you know short-term from long-term memory? Tell me how you prompt. Tell me how you use skills and tools.',
        'Fourth is trust in the collective. When you hit commit, you own that line. You are fully accountable. Ethics, regulation and compliance all come back to this. Trust. Take the responsibility in your hands. Then everything becomes easy.',
      ];
      let i = 0, t0 = 0, iv;
      const paint = () => {
        const words = PASS[i].split(/\s+/).length;
        b.innerHTML = `<p class="small muted" style="margin-top:0">Short sentences, one breath each, pause only at full stops. Target 130 to 150 wpm.</p>
          <div class="card" style="font-size:16px;line-height:1.7">${c.esc(PASS[i]).replace(/\. /g, '. <span style="color:var(--accent)">/</span> ')}</div>
          <div class="row"><button class="btn primary" id="pc-go">▶ Start reading</button><button class="btn" id="pc-stop" disabled>■ Stop</button><button class="btn sm" id="pc-next">Next passage</button>
          <span class="small muted">${words} words</span><b id="pc-out" aria-live="polite"></b></div>`;
        b.querySelector('#pc-next').onclick = () => { i = (i + 1) % PASS.length; paint(); };
        b.querySelector('#pc-go').onclick = () => { t0 = performance.now(); b.querySelector('#pc-stop').disabled = false; clearInterval(iv); iv = setInterval(() => { const el = b.querySelector('#pc-out'); if (el) el.textContent = ((performance.now() - t0) / 1000).toFixed(1) + ' s'; }, 100); };
        b.querySelector('#pc-stop').onclick = () => {
          clearInterval(iv); const s = (performance.now() - t0) / 1000; const wpm = Math.round(words / s * 60);
          const v = wpm < 120 ? ['near', 'slow: tighten the gaps inside sentences'] : wpm > 160 ? ['off', 'fast: add a beat at each full stop'] : ['ok', 'on target'];
          b.querySelector('#pc-out').innerHTML = `<span class="chip ${v[0]}">${wpm} wpm · ${v[1]}</span>`; b.querySelector('#pc-stop').disabled = true;
        };
      };
      paint(); return () => clearInterval(iv);
    },
  });

  R({
    type: 'takes', title: 'Practice history', category: CAT.pg, size: 'M', needsSession: false,
    desc: 'Every practice take you recorded here, with pitch variation and long-silence counts over time.',
    render(b, c) {
      const paint = () => {
        const T = c.store.get('takes', []);
        if (!T.length) { b.innerHTML = '<p class="muted">No practice takes yet. Add the <b>Practice studio</b> widget and record one.</p>'; return; }
        b.innerHTML = `<canvas aria-label="Pitch variation across takes"></canvas><div class="legend"><span><i style="background:var(--accent)"></i>pitch variation (st)</span><span><i style="background:var(--off)"></i>longest silence (s)</span></div>
          <ul class="list small">${T.slice().reverse().slice(0, 12).map((t) => `<li><span class="muted" style="min-width:92px">${c.esc(t.date.slice(0, 10))}</span><span style="flex:1">${c.esc(t.prompt)}</span>
          <span class="chip ${t.pitchSd >= 3 ? 'ok' : 'near'}">${t.pitchSd} st</span><span class="chip ${t.longest > 2 ? 'off' : 'ok'}">${t.longest}s</span></li>`).join('')}</ul>`;
        const cv = b.querySelector('canvas');
        const draw = () => c.chart(cv, [{ data: T.map((t, i) => [i + 1, t.pitchSd]), color: c.cssVar('--accent'), points: true }, { data: T.map((t, i) => [i + 1, t.longest]), color: c.cssVar('--off'), points: true }],
          { xmin: 1, xmax: Math.max(2, T.length), ymin: 0, ymax: Math.max(5, ...T.map((t) => t.longest)), height: 130, xticks: Math.min(8, Math.max(1, T.length - 1)), xfmt: (x) => '#' + Math.round(x), yfmt: (v) => v.toFixed(0) });
        draw();
      };
      paint(); return c.bus.on('takes', paint);
    },
  });

  R({
    type: 'journal', title: 'Daily reflection', category: CAT.pr, size: 'M', needsSession: false,
    desc: 'Two-minute journal: what you noticed in your voice today. Saved per day in this browser.',
    render(b, c) {
      const J = c.store.get('journal', {}); const d = c.today();
      b.innerHTML = `<label class="small muted" for="jr-t">Today (${d}): what did you notice? What will you try tomorrow?</label>
        <textarea id="jr-t" rows="4" style="margin-top:6px">${c.esc(J[d] || '')}</textarea><div class="tiny muted" id="jr-s">Autosaves as you type.</div>
        <div class="pcat">Earlier entries</div><ul class="list small">${Object.keys(J).filter((k) => k !== d && J[k]).sort().reverse().slice(0, 7).map((k) => `<li><b style="min-width:92px">${k}</b><span>${c.esc(J[k])}</span></li>`).join('') || '<li class="muted">None yet.</li>'}</ul>`;
      let tm; b.querySelector('#jr-t').oninput = (e) => { clearTimeout(tm); tm = setTimeout(() => { const j = c.store.get('journal', {}); j[d] = e.target.value; c.store.set('journal', j); c.activity.mark('journal', !!e.target.value.trim()); b.querySelector('#jr-s').textContent = 'Saved ' + new Date().toLocaleTimeString(); }, 400); };
      return () => clearTimeout(tm);
    },
  });

  // ===================== PROGRESS =====================
  R({
    type: 'streak', title: 'Streak & last 4 weeks', category: CAT.pg, size: 'S', needsSession: false,
    desc: 'Days you practised: exercises ticked, takes recorded, journal written, or audio reviewed.',
    render(b, c) {
      const paint = () => {
        const days = []; const now = new Date();
        for (let i = 27; i >= 0; i--) { const d = new Date(now); d.setDate(now.getDate() - i); days.push(d); }
        const key = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        let streak = 0; for (let i = days.length - 1; i >= 0; i--) { if (c.activity.score(key(days[i])) > 0) streak++; else if (i !== days.length - 1) break; }
        b.innerHTML = `<div class="row" style="margin-bottom:8px"><span class="big">🔥 ${streak} day${streak === 1 ? '' : 's'}</span><span class="small muted">current streak</span></div>
          <div class="heat" role="img" aria-label="Practice activity over the last 28 days">${days.map((d) => { const s = c.activity.score(key(d)); const lv = s >= 4 ? 3 : s >= 2 ? 2 : s >= 1 ? 1 : 0;
            return `<div class="${lv ? 'l' + lv : ''} ${key(d) === c.today() ? 'today' : ''}" title="${key(d)}: ${s} activit${s === 1 ? 'y' : 'ies'}">${d.getDate()}</div>`; }).join('')}</div>
          <p class="tiny muted">Counts: exercises ticked, practice takes, journal, listening.</p>`;
      };
      paint(); const o1 = c.bus.on('activity', paint); return o1;
    },
  });

  R({
    type: 'trends', title: 'Trends across sessions', category: CAT.pg, size: 'XL',
    desc: 'How each key metric moves from recording to recording, against its target band.',
    render(b, c) {
      const S = c.sessions; const keys = ['mid_clause_pct', 'wpm_gross', 'f0_sd_st', 'long_gaps', 'repeats', 'falling_end_pct'];
      b.innerHTML = (S.length < 2 ? `<p class="small muted" style="margin-top:0">Only one session so far: this is your <b>baseline</b>. Add a new recording with analyze.py and the lines will appear.</p>` : '') +
        `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">${keys.map((k) => `<div class="card"><div class="small"><b>${c.esc(c.targets[k].label)}</b> <span class="muted">target ${c.esc(targetText(c.targets[k]))}</span></div><canvas data-k="${k}"></canvas></div>`).join('')}</div>`;
      const draw = () => b.querySelectorAll('canvas').forEach((cv) => {
        const k = cv.dataset.k; const t = c.targets[k]; const ys = S.map((s) => s.metrics[k]);
        const lo = Math.min(...ys, t.lo ?? Infinity, t.hi ?? Infinity); const hi = Math.max(...ys, t.lo ?? -Infinity, t.hi ?? -Infinity);
        c.chart(cv, [{ data: S.map((s, i) => [i + 1, s.metrics[k]]), color: c.cssVar('--accent'), points: true, width: 2 }], {
          xmin: 0.8, xmax: Math.max(1.2, S.length + 0.2), ymin: Math.floor(lo * 0.8), ymax: Math.ceil(hi * 1.15 + 0.5), band: [t.lo, t.hi], height: 110, xticks: Math.max(1, S.length - 1), xfmt: (x) => (Math.abs(x - Math.round(x)) < 0.1 ? '#' + Math.round(x) : ''), yfmt: (v) => (v < 10 ? v.toFixed(1) : Math.round(v)) });
      });
      draw(); return c.onResize(b, draw);
    },
  });

  R({
    type: 'addsession', title: 'Add a new recording', category: CAT.pg, size: 'M', needsSession: false,
    desc: 'How to analyse a new video or practice take and add it to this dashboard.',
    render(b, c) {
      const cmds = ['cd ~/voice-analysis/dashboard', 'uv run analyze.py "https://youtu.be/VIDEO_ID" --title "My next video"', 'uv run analyze.py ~/Downloads/take.webm --title "Practice take"'];
      b.innerHTML = `<ol class="small" style="padding-left:18px"><li>Run one of these in Terminal:</li></ol>${cmds.map((x) => `<div class="row"><pre class="cmd" style="flex:1">${c.esc(x)}</pre><button class="btn sm" data-copy="${c.esc(x)}">Copy</button></div>`).join('')}
        <ol class="small" start="2" style="padding-left:18px"><li>Reload this page. The new session appears in the <b>Session</b> menu and in <b>Trends</b>.</li>
        <li>Optional: ask Kiro to write a curated review; it goes in <code>notes/&lt;id&gt;.json</code>.</li></ol>
        <p class="tiny muted">Everything runs on this Mac. Audio is not uploaded anywhere.</p>`;
      b.querySelectorAll('[data-copy]').forEach((x) => (x.onclick = () => { navigator.clipboard?.writeText(x.dataset.copy); c.toast('Copied'); }));
    },
  });
})();
