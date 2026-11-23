/* ===================================================================================
 * PLANNER — general calendar for everyone + cohort design (drafts) for Program Managers
 *   Timeline: every cohort as a row, one bar per block (course)
 *   Month:    classic month grid with every session of every cohort
 *   SMEs:     who teaches what and when, time off, double bookings
 *   Drafts:   plan a new cohort (dates, order of courses, SMEs) and see conflicts live
 * =================================================================================== */
var PL_TABS = [['timeline', 'Timeline'], ['month', 'Month'], ['smes', 'SME availability'], ['drafts', 'Cohort drafts']];

function plKey(email, name) { return email ? String(email).toLowerCase() : (name ? 'name:' + normName(name) : ''); }
function plShortCohort(n) { return String(n || '').replace(/^cohort\s*/i, 'C').replace(/\s+/g, ' '); }
function plShortBlock(b) { return b.kind === 'welcome' ? 'W' : b.kind === 'course' ? 'C' + b.number : b.kind === 'case_study' ? (b.number || 'CS') : b.kind === 'wrapup' ? 'END' : (b.title || '').slice(0, 6); }
function plDays(a, b) { return Math.round((pd(b) - pd(a)) / 864e5); }

// Dates for a draft: welcome blocks on the welcome date, then every module session on the chosen weekdays
function draftSchedule(d) {
  var blocks = (d.blocks || []).map(function (b, i) { return Object.assign({}, b, { key: b.key || 'd' + i }); });
  var sessions = [];
  blocks.forEach(function (b) { (b.modules || []).forEach(function (m) { for (var k = 0; k < (m.sessions || 2); k++) sessions.push({ blockKey: b.key, moduleNo: m.no || '', moduleTitle: m.title || '' }); }); });
  var regular = sessions.filter(function (s) { return blocks.find(function (b) { return b.key === s.blockKey; }).kind !== 'welcome'; });
  var dates = generateDates(d.firstDate, d.weekdays || [1, 3], d.skip || [], regular.length);
  regular.forEach(function (s, i) { s.date = dates[i] || ''; });
  sessions.forEach(function (s) { if (blocks.find(function (b) { return b.key === s.blockKey; }).kind === 'welcome') s.date = d.welcomeDate || ''; });
  return { blocks: blocks, sessions: sessions };
}

// Rows (cohorts + drafts) with their blocks, dates and SMEs; double bookings per SME and date
function plannerModel(P, opts) {
  opts = opts || {};
  var t = P.today;
  var smeName = {}; (P.smes || []).forEach(function (s) { smeName[plKey(s.email, s.name)] = s.name; });
  var rows = [];
  P.cohorts.forEach(function (c) {
    var bl = P.blocks.filter(function (b) { return b.cohortId === c.id; }).sort(function (a, b) { return a.order - b.order; });
    var ss = P.sessions.filter(function (s) { return s.c === c.id; });
    rows.push({ id: c.id, name: c.name, short: plShortCohort(c.name), status: c.status, draft: false, language: c.language,
      blocks: bl.map(function (b) {
        var bs = ss.filter(function (s) { return s.b === b.id; });
        return { id: b.id, kind: b.kind, number: b.number, title: b.title, sme: plKey(b.smeEmail, b.smeName), smeLabel: b.smeEmail ? (smeName[b.smeEmail] || b.smeEmail) : (b.smeName || ''),
          sessions: bs.map(function (s) { return { date: s.d, no: s.no, title: s.t, sme: plKey(s.se, s.sn) || plKey(b.smeEmail, b.smeName) }; }).sort(function (x, y) { return x.date.localeCompare(y.date); }) };
      }) });
  });
  (P.drafts || []).forEach(function (d) {
    if (opts.onlyDraft && opts.onlyDraft !== d.id) return;
    var st = draftSchedule(d.data || {});
    rows.push({ id: 'draft:' + d.id, draftId: d.id, name: d.name, short: d.name, status: 'Draft', draft: true,
      blocks: st.blocks.map(function (b) {
        return { id: b.key, kind: b.kind, number: b.number, title: b.title, sme: plKey(b.smeEmail, b.smeName), smeLabel: b.smeEmail ? (smeName[b.smeEmail] || b.smeEmail) : (b.smeName || ''),
          sessions: st.sessions.filter(function (s) { return s.blockKey === b.key && s.date; }).map(function (s) { return { date: s.date, no: s.moduleNo, title: s.moduleTitle, sme: plKey(b.smeEmail, b.smeName) }; }) };
      }) });
  });
  rows.forEach(function (r) {
    r.blocks.forEach(function (b) { var ds = b.sessions.map(function (s) { return s.date; }); b.first = ds[0] || ''; b.last = ds[ds.length - 1] || ''; });
    var all = r.blocks.map(function (b) { return b.first; }).concat(r.blocks.map(function (b) { return b.last; })).filter(Boolean).sort();
    r.first = all[0] || ''; r.last = all[all.length - 1] || '';
  });
  // double bookings: same SME, same date, different rows (drafts compete with real cohorts)
  var byDay = {};
  rows.forEach(function (r) { r.blocks.forEach(function (b) { b.sessions.forEach(function (s) { if (!s.sme) return; var k = s.sme + '|' + s.date; (byDay[k] = byDay[k] || []).push({ row: r, block: b, s: s }); }); }); });
  var clashes = [];
  Object.keys(byDay).forEach(function (k) {
    var list = byDay[k], ids = {}; list.forEach(function (x) { ids[x.row.id] = 1; });
    if (Object.keys(ids).length > 1) { list.forEach(function (x) { x.s.clash = true; x.block.clash = true; }); clashes.push({ sme: k.split('|')[0], date: k.split('|')[1], items: list }); }
  });
  // time off
  var off = (P.unavailability || []).map(function (u) { return Object.assign({}, u, { key: u.smeKey.indexOf('@') > 0 ? u.smeKey.toLowerCase() : 'name:' + normName(u.smeKey.replace(/^name:/, '')) }); });
  rows.forEach(function (r) { r.blocks.forEach(function (b) { b.sessions.forEach(function (s) {
    var o = off.find(function (u) { return u.key === s.sme && s.date >= u.from && s.date <= u.to; });
    if (o) { s.off = o; b.off = true; }
  }); }); });
  return { rows: rows, clashes: clashes.sort(function (a, b) { return a.date.localeCompare(b.date); }), off: off, smeName: smeName, today: t };
}

function viewPlanner(main, r) {
  var pm = isPM();
  var tabs = PL_TABS.filter(function (t) { return pm || t[0] !== 'drafts'; });
  var tab = tabs.some(function (t) { return t[0] === r.id; }) ? r.id : 'timeline';
  main.appendChild(h('.epm-page-head', h('div', h('h1', 'Planner'), h('p.epm-sub', 'Every cohort on one calendar' + (pm ? ', SME availability and drafts to plan the next cohorts.' : ' and SME availability.'))),
    h('.epm-actions', btn('Refresh', { icon: 'sync', kind: 'ghost' }, function () { S.planner = null; render(); }))));
  main.appendChild(h('nav.epm-tabs', tabs.map(function (t) { return h('a.epm-tab', { href: '#/planner/' + t[0], class: t[0] === tab ? 'on' : '' }, t[1]); })));
  var body = h('div', h('.epm-loading', 'Loading…'));
  main.appendChild(body);
  (S.planner ? Promise.resolve(S.planner) : api('planner.get', {}).then(function (P) { S.planner = P; return P; })).then(function (P) {
    clear(body);
    ({ timeline: plTimeline, month: plMonth, smes: plSmes, drafts: plDrafts })[tab](body, P, r);
  }).catch(function (e) { clear(body); body.appendChild(empty(e.message)); });
}

/* ---------------- timeline (Gantt) ---------------- */
function ganttChart(rows, opts) {
  opts = opts || {};
  var t = opts.today || today();
  var ds = [];
  rows.forEach(function (r) { r.bars.forEach(function (b) { if (b.first) ds.push(b.first, b.last); }); (r.extra || []).forEach(function (e) { ds.push(e.from, e.to); }); });
  ds = ds.filter(Boolean).sort();
  if (!ds.length) return empty('No dated sessions to show.');
  var start = opts.from || addDays(ds[0], -7);
  var end = opts.to || addDays(ds[ds.length - 1], 10);
  var dayPx = opts.dayPx || 4, days = plDays(start, end) + 1, W = days * dayPx;
  var x = function (d) { return plDays(start, d) * dayPx; };
  var inner = h('.epm-gantt-inner', { style: { width: (W + 190) + 'px' } });
  var head = h('.epm-gantt-head', h('.epm-gantt-label'));
  var track = h('.epm-gantt-track', { style: { width: W + 'px' } });
  var d0 = pd(start); d0.setUTCDate(1);
  for (var m = iso(d0); m <= end; m = iso(new Date(Date.UTC(pd(m).getUTCFullYear(), pd(m).getUTCMonth() + 1, 1)))) {
    if (m < start) continue;
    track.appendChild(h('.epm-gantt-month', { style: { left: x(m) + 'px' } }, MONTHS[pd(m).getUTCMonth()] + ' ' + String(pd(m).getUTCFullYear()).slice(2)));
  }
  if (t >= start && t <= end) track.appendChild(h('.epm-gantt-today', { style: { left: x(t) + 'px' }, title: 'Today' }));
  head.appendChild(track);
  inner.appendChild(head);
  rows.forEach(function (r) {
    // bars that overlap in time go to separate lanes so they never cover each other
    var lanes = [];
    r.bars.filter(function (b) { return b.first; }).sort(function (a, b) { return a.first.localeCompare(b.first); }).forEach(function (b) {
      var px0 = x(b.first), px1 = px0 + Math.max(6, (plDays(b.first, b.last) + 1) * dayPx);
      var li = lanes.findIndex(function (end) { return end + 3 <= px0; });
      if (li < 0) { li = lanes.length; lanes.push(0); }
      lanes[li] = Math.max(px1, px0 + (b.label ? 30 : 0)); b.lane = li;
    });
    var nl = Math.max(1, lanes.length);
    var tr = h('.epm-gantt-track', { style: { width: W + 'px', height: (24 + nl * 28) + 'px' } });
    if (t >= start && t <= end) tr.appendChild(h('.epm-gantt-todayline', { style: { left: x(t) + 'px' } }));
    (r.extra || []).forEach(function (e) {   // time off
      if (e.to < start || e.from > end) return;
      tr.appendChild(h('.epm-gantt-off', { style: { left: x(e.from < start ? start : e.from) + 'px', width: Math.max(6, (plDays(e.from, e.to) + 1) * dayPx) + 'px' }, title: (e.label || 'Time off') + ' · ' + fmtDate(e.from) + ' – ' + fmtDate(e.to) }, e.label || ''));
    });
    r.bars.forEach(function (b) {
      if (!b.first) return;
      var w = Math.max(6, (plDays(b.first, b.last) + 1) * dayPx);
      var bar = h('.epm-gantt-bar', { class: 'k-' + b.kind + (r.draft || b.draft ? ' draft' : '') + (b.clash ? ' clash' : '') + (b.off ? ' off' : '') + (b.last < t ? ' past' : ''),
        style: { left: x(b.first) + 'px', width: w + 'px', top: (12 + (b.lane || 0) * 28) + 'px' }, title: b.tip, tabindex: b.href ? '0' : null,
        onclick: b.href ? function () { location.hash = b.href; } : null }, w > 26 ? h('span', b.label) : null);
      (b.ticks || []).forEach(function (d) { bar.appendChild(h('i', { style: { left: (x(d) - x(b.first)) + 'px', width: Math.max(2, dayPx - 1) + 'px' } })); });
      tr.appendChild(bar);
    });
    inner.appendChild(h('.epm-gantt-row', { class: r.draft ? 'draft' : '' }, h('.epm-gantt-label', { title: r.title || r.name }, h('b', r.name), r.sub ? h('small', r.sub) : null), tr));
  });
  var wrap = h('.epm-gantt', inner);
  setTimeout(function () { if (t >= start && t <= end) wrap.scrollLeft = Math.max(0, x(t) - 260); }, 0);
  return wrap;
}
function plBlockTip(r, b) {
  return [r.name, blockLabel(b), b.smeLabel ? 'SME: ' + b.smeLabel : 'No SME', b.first ? fmtDate(b.first) + ' – ' + fmtDate(b.last) : '', b.sessions.length + ' sessions',
    b.clash ? '⚠ SME teaches another cohort on the same day' : '', b.off ? '⚠ SME has time off' : ''].filter(Boolean).join('\n');
}
function plTimeline(el, P) {
  var showDone = false, showDrafts = true, zoom = 4;
  var bar = h('.epm-toolbar',
    h('label.epm-check', h('input', { type: 'checkbox', onchange: function () { showDone = this.checked; draw(); } }), h('span', 'Show completed cohorts')),
    isPM() ? h('label.epm-check', h('input', { type: 'checkbox', checked: true, onchange: function () { showDrafts = this.checked; draw(); } }), h('span', 'Show drafts')) : null,
    h('.epm-spacer'), h('span.epm-small.epm-muted', 'Zoom'),
    selectEl([{ value: 2, label: 'Year' }, { value: 4, label: 'Quarter' }, { value: 8, label: 'Month' }], 4, { 'aria-label': 'Zoom', onchange: function () { zoom = Number(this.value); draw(); } }));
  var out = h('div'), legend = h('.epm-legend.epm-gantt-legend',
    h('span.epm-legend-i', h('i.k-course')), 'Course', h('span.epm-legend-i', h('i.k-case_study')), 'Case study', h('span.epm-legend-i', h('i.k-welcome')), 'Welcome / wrap-up',
    h('span.epm-legend-i', h('i.k-draft')), 'Draft', h('span.epm-legend-i', h('i.k-clash')), 'SME double-booked');
  append(el, [bar, legend, out]);
  function draw() {
    clear(out);
    var M = plannerModel(P);
    var rows = M.rows.filter(function (r) { return r.draft ? showDrafts : (showDone || r.status !== 'Completed'); })
      .sort(function (a, b) { return String(a.first || '9').localeCompare(String(b.first || '9')); })
      .map(function (r) {
        return { name: r.name, draft: r.draft, sub: r.draft ? 'Draft' : r.status + (r.first ? ' · ' + fmtDate(r.first) + ' – ' + fmtDate(r.last) : ''),
          bars: r.blocks.map(function (b) { return { first: b.first, last: b.last, kind: b.kind, label: plShortBlock(b), clash: b.clash, off: b.off, tip: plBlockTip(r, b),
            ticks: b.sessions.map(function (s) { return s.date; }), href: r.draft ? '#/planner/drafts/' + r.draftId : '#/c/' + r.id + '/calendar' }; }) };
      });
    out.appendChild(ganttChart(rows, { dayPx: zoom, today: M.today }));
    out.appendChild(h('p.epm-small.epm-muted', 'Each bar is a course from its first to its last session; the small marks are the sessions. Hover for details, click to open the calendar.'));
  }
  draw();
}

/* ---------------- month grid ---------------- */
function plMonth(el, P) {
  var M = plannerModel(P);
  var showDrafts = false;
  var cur = (M.today || today()).slice(0, 7) + '-01';
  var colors = {}; M.rows.filter(function (r) { return !r.draft; }).sort(function (a, b) { return String(a.first).localeCompare(String(b.first)); })
    .filter(function (r) { return r.status !== 'Completed'; }).forEach(function (r, i) { colors[r.id] = SERIES[i % SERIES.length]; });
  var title = h('h2.epm-month-title');
  var bar = h('.epm-toolbar', btn('', { icon: 'back', kind: 'ghost', aria: 'Previous month' }, function () { move(-1); }), title,
    btn('', { icon: 'chevron', kind: 'ghost', aria: 'Next month' }, function () { move(1); }), btn('Today', { kind: 'ghost' }, function () { cur = (M.today || today()).slice(0, 7) + '-01'; draw(); }),
    h('.epm-spacer'), isPM() ? h('label.epm-check', h('input', { type: 'checkbox', onchange: function () { showDrafts = this.checked; draw(); } }), h('span', 'Show drafts')) : null);
  var out = h('div');
  append(el, [bar, out]);
  function move(n) { var d = pd(cur); cur = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))); draw(); }
  function draw() {
    clear(out);
    var d = pd(cur), y = d.getUTCFullYear(), mo = d.getUTCMonth();
    title.textContent = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][mo] + ' ' + y;
    var byDay = {};
    M.rows.forEach(function (r) {
      if (r.draft && !showDrafts) return;
      r.blocks.forEach(function (b) { b.sessions.forEach(function (s) { (byDay[s.date] = byDay[s.date] || []).push({ r: r, b: b, s: s }); }); });
    });
    var first = new Date(Date.UTC(y, mo, 1)), offset = (first.getUTCDay() + 6) % 7;
    var startD = iso(new Date(Date.UTC(y, mo, 1 - offset)));
    var grid = h('.epm-month', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(function (w) { return h('.epm-month-wd', w); }));
    for (var i = 0; i < 42; i++) {
      var day = addDays(startD, i), inMonth = pd(day).getUTCMonth() === mo;
      if (i >= 35 && !inMonth) break;
      var items = (byDay[day] || []).sort(function (a, b) { return a.r.name.localeCompare(b.r.name); });
      grid.appendChild(h('.epm-month-day', { class: (inMonth ? '' : 'out ') + (day === M.today ? 'today' : '') },
        h('.epm-month-n', String(pd(day).getUTCDate())),
        items.map(function (it) {
          var tip = it.r.name + ' · ' + (it.s.no ? it.s.no + ' ' : '') + (it.s.title || it.b.title) + (it.b.smeLabel ? '\nSME: ' + it.b.smeLabel : '') + (it.s.clash ? '\n⚠ SME double-booked this day' : '') + (it.s.off ? '\n⚠ SME time off: ' + (it.s.off.note || '') : '');
          return h(it.r.draft ? 'span.epm-mchip' : 'a.epm-mchip', { href: it.r.draft ? null : '#/c/' + it.r.id + '/calendar', title: tip,
            class: (it.r.draft ? 'draft ' : '') + (it.s.clash || it.s.off ? 'clash' : ''), style: { borderLeftColor: colors[it.r.id] || '#9a9a96' } },
            h('b', it.r.short), ' ', it.s.no || plShortBlock(it.b), it.b.smeLabel ? h('span', ' · ' + it.b.smeLabel.split(' ')[0]) : null);
        })));
    }
    out.appendChild(h('.epm-month-wrap', grid));
  }
  draw();
}

/* ---------------- SME availability ---------------- */
function plSmes(el, P) {
  var pm = isPM(), zoom = 4;
  var M = plannerModel(P);
  var out = h('div');
  var bar = h('.epm-toolbar', h('p.epm-muted', pm ? 'Who teaches what and when across every cohort (and your drafts).' : 'Your courses across cohorts. Add your time off so the Program Managers can plan around it.'),
    h('.epm-spacer'), selectEl([{ value: 2, label: 'Year' }, { value: 4, label: 'Quarter' }, { value: 8, label: 'Month' }], 4, { 'aria-label': 'Zoom', onchange: function () { zoom = Number(this.value); draw(); } }),
    btn('Add time off', { icon: 'plus', kind: 'primary' }, function () { offModal(P); }));
  append(el, [bar, out]);
  function draw() {
    clear(out);
    var keys = {};
    M.rows.forEach(function (r) { if (r.status === 'Completed') return; r.blocks.forEach(function (b) { if (b.sme && b.last >= addDays(M.today, -30)) keys[b.sme] = b.smeLabel || b.sme; }); });
    M.off.forEach(function (u) { keys[u.key] = keys[u.key] || M.smeName[u.key] || u.smeKey.replace(/^name:/, ''); });
    if (!pm) { var me = S.user.email.toLowerCase(); Object.keys(keys).forEach(function (k) { if (k !== me) delete keys[k]; }); if (!keys[me]) keys[me] = S.user.name || me; }
    var rows = Object.keys(keys).sort(function (a, b) { return String(keys[a]).localeCompare(String(keys[b])); }).map(function (k) {
      var bars = [];
      M.rows.forEach(function (r) {
        if (r.status === 'Completed') return;
        r.blocks.forEach(function (b) {
          if (b.sme !== k) return;
          bars.push({ first: b.first, last: b.last, kind: b.kind, draft: r.draft, clash: b.clash, off: b.off, label: r.short + ' ' + plShortBlock(b), tip: plBlockTip(r, b), ticks: b.sessions.map(function (s) { return s.date; }),
            href: r.draft ? '#/planner/drafts/' + r.draftId : '#/c/' + r.id + '/calendar' });
        });
      });
      return { name: keys[k], sub: k.indexOf('@') > 0 ? k : 'No account yet', bars: bars, extra: M.off.filter(function (u) { return u.key === k; }).map(function (u) { return { from: u.from, to: u.to, label: u.note || 'Time off' }; }) };
    });
    out.appendChild(ganttChart(rows, { dayPx: zoom, today: M.today }));
    // double bookings
    var clashes = M.clashes.filter(function (c) { return pm || c.sme === S.user.email.toLowerCase(); }).filter(function (c) { return c.date >= addDays(M.today, -7); });
    out.appendChild(h('.epm-card', h('h3', 'Double bookings ', badge(String(clashes.length), clashes.length ? 'bad' : 'good')),
      clashes.length ? h('ul.epm-risk', clashes.map(function (c) {
        return h('li', h('span', h('b', fmtDate(c.date, true)), ' · ', keys[c.sme] || M.smeName[c.sme] || c.sme), h('span.epm-muted', c.items.map(function (x) { return x.row.short + ' ' + plShortBlock(x.block); }).join(' and ')));
      })) : h('p.epm-muted', 'No SME is teaching two cohorts on the same day.')));
    // time off
    var offs = M.off.filter(function (u) { return pm || u.key === S.user.email.toLowerCase(); }).sort(function (a, b) { return a.from.localeCompare(b.from); });
    out.appendChild(h('.epm-card', h('h3', 'Time off'), offs.length ? h('.epm-table-wrap', h('table.epm-table.epm-table-sm', h('thead', h('tr', h('th', 'SME'), h('th', 'From'), h('th', 'To'), h('th', 'Note'), h('th', ''))),
      h('tbody', offs.map(function (u) {
        return h('tr', h('td', keys[u.key] || M.smeName[u.key] || u.smeKey), h('td', fmtDate(u.from)), h('td', fmtDate(u.to)), h('td.epm-small', u.note || ''),
          h('td', btn('', { icon: 'trash', kind: 'ghost', aria: 'Delete' }, function () {
            confirmBox('Delete this time off?', fmtDate(u.from) + ' – ' + fmtDate(u.to), 'Delete', true).then(function (ok) { if (ok) api('unavail.delete', { id: u.id }).then(function () { S.planner = null; render(); }).catch(fail); });
          })));
      })))) : h('p.epm-muted', 'No time off registered.')));
  }
  draw();
}
function offModal(P) {
  var pm = isPM();
  var who = pm ? selectEl((P.smes || []).filter(function (s) { return s.role === 'SME' || !s.email; }).map(function (s) { return { value: s.email || s.key, label: s.name }; }), '') : null;
  var from = inputEl(today(), { type: 'date' }), to = inputEl(today(), { type: 'date' }), note = inputEl('', { placeholder: 'Vacation, conference…' });
  var m = modal('Add time off', [pm ? field('SME', who) : h('p.epm-p', 'For ', h('b', S.user.name || S.user.email)), h('.epm-row2', field('From', from), field('To', to)), field('Note', note)], {
    footer: [btn('Cancel', { kind: 'ghost' }, function () { m.close(); }), btn('Save', { kind: 'primary' }, function () {
      api('unavail.save', { record: { smeKey: pm ? who.value : S.user.email, from: from.value, to: to.value, note: note.value } }).then(function () { m.close(); S.planner = null; render(); }).catch(fail);
    })],
  });
}

/* ---------------- drafts (design a new cohort) ---------------- */
function plDrafts(el, P, r) {
  var drafts = (P.drafts || []).slice().sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
  var selId = r.tab || (drafts[0] && drafts[0].id) || '';
  var list = h('.epm-dlist',
    btn('New draft', { icon: 'plus', kind: 'primary' }, function () {
      var B = S.boot;
      var st = templateStructure(B.template);
      var data = { language: 'en', welcomeDate: '', firstDate: '', weekdays: [1, 3], skip: [], blocks: draftBlocksFrom(st) };
      api('draft.save', { draft: { name: 'New cohort draft', data: data } }).then(function (res) { S.planner = null; go('planner/drafts/' + res.id); }).catch(fail);
    }),
    drafts.map(function (d) { return h('a.epm-dlist-i', { href: '#/planner/drafts/' + d.id, class: d.id === selId ? 'on' : '' }, h('b', d.name), h('small', 'Updated ' + fmtDateTime(d.updatedAt))); }));
  var editor = h('.epm-deditor');
  el.appendChild(h('.epm-drafts', list, editor));
  var d = drafts.find(function (x) { return x.id === selId; });
  if (!d) { editor.appendChild(empty('Create a draft to plan a cohort: choose the dates, reorder the courses, assign SMEs and check who is available. Drafts never affect real cohorts until you create the cohort.')); return; }
  draftEditor(editor, P, d);
}
// Draft blocks keep modules (title + number of sessions) so dates can be recalculated
function draftBlocksFrom(st) {
  var byKey = {}; st.blocks.forEach(function (b, i) { byKey[b.key] = { key: 'd' + i, kind: b.kind, number: b.number, title: b.title, smeEmail: b.smeEmail || '', smeName: b.smeName || '', modules: [] }; });
  st.sessions.forEach(function (s) {
    var b = byKey[s.blockKey]; if (!b) return;
    var last = b.modules[b.modules.length - 1];
    if (last && last.no === (s.moduleNo || '') && last.title === (s.moduleTitle || '')) last.sessions++;
    else b.modules.push({ no: s.moduleNo || '', title: s.moduleTitle || '', sessions: 1 });
  });
  return st.blocks.map(function (b) { return byKey[b.key]; });
}
function draftEditor(el, P, d) {
  var data = JSON.parse(JSON.stringify(d.data || {}));
  data.blocks = data.blocks || []; data.weekdays = data.weekdays || [1, 3]; data.skip = data.skip || [];
  var dirty = false;
  var name = inputEl(d.name, { oninput: function () { dirty = true; } });
  var lang = selectEl([{ value: 'en', label: 'English' }, { value: 'es', label: 'Spanish' }], data.language || 'en', { onchange: function () { data.language = this.value; dirty = true; } });
  var welcome = inputEl(data.welcomeDate, { type: 'date', onchange: function () { data.welcomeDate = this.value; update(); } });
  var first = inputEl(data.firstDate, { type: 'date', onchange: function () { data.firstDate = this.value; update(); } });
  var days = h('.epm-checks', [1, 2, 3, 4, 5, 6].map(function (n) { return h('label.epm-check', h('input', { type: 'checkbox', value: String(n), checked: data.weekdays.indexOf(n) >= 0, onchange: function () {
    data.weekdays = Array.prototype.slice.call(days.querySelectorAll('input:checked')).map(function (i) { return Number(i.value); }); update(); } }), h('span', WD[n])); }));
  var skip = textareaEl(data.skip.join('\n'), { rows: 2, placeholder: 'Holiday weeks: one date per line (YYYY-MM-DD)', onchange: function () { data.skip = this.value.split(/\s+/).filter(Boolean); update(); } });
  var source = selectEl([{ value: '', label: 'Replace the courses with…' }, { value: 'template', label: 'The default program template' }, { value: 'csv', label: 'A program calendar CSV (keeps its dates)' }]
    .concat(P.cohorts.slice().sort(function (a, b) { return String(b.startDate).localeCompare(String(a.startDate)); }).map(function (c) { return { value: c.id, label: 'The structure of ' + c.name }; })), '');
  var csvIn = h('input', { type: 'file', accept: '.csv,text/csv', style: { display: 'none' } });
  source.addEventListener('change', function () {
    var v = source.value; if (!v) return;
    if (v === 'csv') { csvIn.click(); source.value = ''; return; }
    (v === 'template' ? Promise.resolve(templateStructure(S.boot.template)) : loadCohort(v).then(copyStructure)).then(function (st) { data.blocks = draftBlocksFrom(st); source.value = ''; update(); }).catch(fail);
  });
  csvIn.addEventListener('change', function () {
    readCalendarFile(csvIn).then(function (st) {
      data.blocks = draftBlocksFrom(st);
      var ds = st.sessions.map(function (s) { return s.date; }).filter(Boolean).sort();
      var wel = st.sessions.find(function (s) { return st.blocks.find(function (b) { return b.key === s.blockKey; }).kind === 'welcome'; });
      data.welcomeDate = wel ? wel.date : ''; data.firstDate = st.sessions.filter(function (s) { return s !== wel; }).map(function (s) { return s.date; }).sort()[0] || ds[0];
      var wds = {}; st.sessions.forEach(function (s) { if (s !== wel && s.date) wds[pd(s.date).getUTCDay()] = 1; }); data.weekdays = Object.keys(wds).map(Number).slice(0, 3);
      welcome.value = data.welcomeDate; first.value = data.firstDate;
      Array.prototype.forEach.call(days.querySelectorAll('input'), function (i) { i.checked = data.weekdays.indexOf(Number(i.value)) >= 0; });
      toast('Courses loaded from the CSV. Dates follow the first date and the session days; add the holiday weeks.');
      update();
    }).catch(fail);
    csvIn.value = '';
  });
  var tableBox = h('div'), conflictBox = h('div'), timelineBox = h('div');
  var saveBtn = btn('Save draft', { kind: 'primary' }, save);
  append(el, [
    h('.epm-card', h('.epm-card-head', h('h3', 'Draft'), h('.epm-actions', btn('Delete', { icon: 'trash', kind: 'danger-ghost' }, del), saveBtn)),
      h('.epm-row2', field('Name', name), field('Language', lang)),
      h('.epm-row3', field('Welcome session', welcome), field('First module session', first), field('Session days', days)),
      field('Weeks without sessions', skip), h('.epm-row2', source, csvIn)),
    h('.epm-card', h('.epm-card-head', h('h3', 'Courses, dates and SMEs'), btn('Add course', { icon: 'plus', kind: 'ghost' }, function () {
      data.blocks.push({ key: 'n' + Date.now(), kind: 'course', number: '', title: 'New course', smeEmail: '', smeName: '', modules: [{ no: '', title: '', sessions: 2 }] }); update(); })), tableBox),
    conflictBox, timelineBox,
    h('.epm-card', h('h3', 'Create the cohort'), h('p.epm-small.epm-muted', 'Creates a real cohort (status Planned) with these courses, dates and SMEs. The draft stays here for reference.'),
      btn('Create cohort from this draft', { icon: 'check', kind: 'primary' }, createCohort))]);
  function update() { dirty = true; saveBtn.classList.add('epm-pulse'); draw(); }
  function draw() {
    var sched = draftSchedule(data);
    var Pm = Object.assign({}, P, { drafts: [{ id: d.id, name: name.value || d.name, data: data }] });
    var M = plannerModel(Pm, { onlyDraft: d.id });
    var row = M.rows.find(function (x) { return x.draft; });
    // table
    clear(tableBox);
    var renum = function () { var c = 0, cs = 0; data.blocks.forEach(function (b) { if (b.kind === 'course') b.number = String(++c); else if (b.kind === 'case_study') b.number = 'CS' + (++cs); }); };
    tableBox.appendChild(h('.epm-table-wrap', h('table.epm-table.epm-table-sm.epm-dtable', h('thead', h('tr', h('th', ''), h('th', 'Course'), h('th', 'SME'), h('th.num', 'Weeks'), h('th', 'Dates'), h('th', 'Checks'), h('th', ''))),
      h('tbody', data.blocks.map(function (b, i) {
        var rb = row.blocks[i] || { sessions: [] };
        var weeks = (b.modules || []).length;
        var checks = [];
        if (rb.clash) checks.push(badge('Double-booked', 'bad'));
        if (rb.off) checks.push(badge('SME time off', 'bad'));
        if (!b.smeEmail && !b.smeName && b.kind !== 'welcome' && b.kind !== 'wrapup') checks.push(badge('No SME', 'mid'));
        // other cohorts in the same weeks with the same SME (different days): heads-up only
        var busy = M.rows.filter(function (x) { return !x.draft && x.status !== 'Completed'; }).some(function (x) { return x.blocks.some(function (ob) { return ob.sme && ob.sme === rb.sme && ob.first && rb.first && ob.first <= rb.last && ob.last >= rb.first; }); });
        if (busy && !rb.clash) checks.push(badge('Teaching another cohort these weeks', 'info'));
        if (!checks.length && rb.first) checks.push(badge('OK', 'good'));
        return h('tr', { class: rb.clash || rb.off ? 'epm-row-bad' : '' },
          h('td', h('span.epm-block-no', b.kind === 'course' ? b.number : b.kind === 'case_study' ? 'CS' : b.kind === 'welcome' ? 'W' : '·')),
          h('td', inputEl(b.title, { 'aria-label': 'Title', oninput: function () { b.title = this.value; dirty = true; } }),
            h('div.epm-small.epm-muted', selectEl([['course', 'Course'], ['case_study', 'Case study'], ['welcome', 'Welcome'], ['wrapup', 'Wrap-up'], ['other', 'Other']].map(function (k) { return { value: k[0], label: k[1] }; }), b.kind,
              { 'aria-label': 'Kind', class: 'epm-input-sm', onchange: function () { b.kind = this.value; renum(); update(); } }))),
          h('td', selectEl(smeOptions('No SME'), smeValue(b), { 'aria-label': 'SME', onchange: function () { applySme(b, this.value); update(); } })),
          h('td.num', inputEl(weeks, { type: 'number', min: '1', max: '12', style: { width: '64px' }, 'aria-label': 'Weeks', onchange: function () {
            var n = Math.max(1, Math.min(12, Number(this.value) || 1)), per = b.kind === 'welcome' ? 1 : 2;
            b.modules = b.modules || [];
            while (b.modules.length < n) b.modules.push({ no: '', title: '', sessions: per });
            b.modules.length = n; update(); } })),
          h('td.epm-nowrap.epm-small', rb.first ? fmtDate(rb.first) + ' – ' + fmtDate(rb.last) : h('span.epm-muted', 'Choose the dates')),
          h('td', checks),
          h('td.epm-nowrap', btn('', { icon: 'up', kind: 'ghost', aria: 'Move up', disabled: i === 0 }, function () { data.blocks.splice(i - 1, 0, data.blocks.splice(i, 1)[0]); renum(); update(); }),
            btn('', { icon: 'down', kind: 'ghost', aria: 'Move down', disabled: i === data.blocks.length - 1 }, function () { data.blocks.splice(i + 1, 0, data.blocks.splice(i, 1)[0]); renum(); update(); }),
            btn('', { icon: 'trash', kind: 'ghost', aria: 'Remove' }, function () { data.blocks.splice(i, 1); renum(); update(); })));
      })))));
    var ds = sched.sessions.map(function (s) { return s.date; }).filter(Boolean).sort();
    tableBox.appendChild(h('p.epm-small.epm-muted', data.blocks.length + ' blocks · ' + sched.sessions.length + ' sessions' + (ds.length ? ' · ' + fmtDate(ds[0]) + ' → ' + fmtDate(ds[ds.length - 1]) : '') +
      ' · Weeks = modules (two sessions each, one for the welcome).'));
    // conflicts detail
    clear(conflictBox);
    var mine = M.clashes.filter(function (c) { return c.items.some(function (x) { return x.row.draft; }); });
    var offs = []; row.blocks.forEach(function (b) { b.sessions.forEach(function (s) { if (s.off) offs.push({ b: b, s: s }); }); });
    conflictBox.appendChild(h('.epm-card', h('h3', 'Availability checks ', badge(String(mine.length + offs.length), mine.length + offs.length ? 'bad' : 'good')),
      mine.length + offs.length ? h('ul.epm-risk', mine.map(function (c) {
        var other = c.items.filter(function (x) { return !x.row.draft; }).map(function (x) { return x.row.name + ' (' + plShortBlock(x.block) + ')'; }).join(', ');
        var me = c.items.find(function (x) { return x.row.draft; });
        return h('li', h('span', h('b', fmtDate(c.date, true)), ' · ', me.block.smeLabel, ' · ', me.block.title), h('span.epm-muted', 'Also teaching ' + other));
      }).concat(offs.map(function (o) { return h('li', h('span', h('b', fmtDate(o.s.date, true)), ' · ', o.b.smeLabel, ' · ', o.b.title), h('span.epm-muted', 'Time off' + (o.s.off.note ? ': ' + o.s.off.note : ''))); })))
        : h('p.epm-muted', row.first ? 'Every SME is free on their dates.' : 'Choose the welcome and first module dates to check availability.')));
    // timeline: this draft next to the cohorts it overlaps
    clear(timelineBox);
    if (row.first) {
      var rows = M.rows.filter(function (x) { return x.draft || (x.status !== 'Completed' && x.last >= row.first && x.first <= row.last); }).map(function (x) {
        return { name: x.draft ? (name.value || 'Draft') : x.name, draft: x.draft, sub: x.draft ? 'Draft' : x.status,
          bars: x.blocks.map(function (b) { return { first: b.first, last: b.last, kind: b.kind, label: plShortBlock(b) + (b.smeLabel ? ' · ' + b.smeLabel.split(' ')[0] : ''), clash: b.clash, off: b.off, tip: plBlockTip(x, b), ticks: b.sessions.map(function (s) { return s.date; }) }; }) };
      });
      timelineBox.appendChild(h('.epm-card', h('h3', 'Next to the other cohorts'), ganttChart(rows, { dayPx: 4, today: M.today })));
    }
  }
  function save() {
    data.language = lang.value;
    return api('draft.save', { draft: { id: d.id, name: name.value, data: data } }).then(function () { dirty = false; saveBtn.classList.remove('epm-pulse'); toast('Draft saved'); S.planner = null; }).catch(fail);
  }
  function del() {
    confirmBox('Delete “' + d.name + '”?', 'Only the draft is deleted; cohorts are not affected.', 'Delete', true).then(function (ok) {
      if (ok) api('draft.delete', { id: d.id }).then(function () { S.planner = null; go('planner/drafts'); }).catch(fail);
    });
  }
  function createCohort() {
    var sched = draftSchedule(data);
    if (!data.firstDate) return toast('Choose the first module date', 'error');
    var nm = inputEl(name.value.replace(/draft/i, '').trim());
    var m = modal('Create the cohort', [field('Cohort name', nm), h('p.epm-small.epm-muted', sched.blocks.length + ' blocks and ' + sched.sessions.length + ' sessions, in ' + (data.language === 'es' ? 'Spanish' : 'English') + '.')], {
      footer: [btn('Cancel', { kind: 'ghost' }, function () { m.close(); }), btn('Create', { kind: 'primary' }, function () {
        var blocks = sched.blocks.map(function (b) { return { key: b.key, kind: b.kind, number: b.number, title: b.title, smeEmail: b.smeEmail, smeName: b.smeName, smeSeesFeedback: true }; });
        var ds = sched.sessions.map(function (s) { return s.date; }).filter(Boolean).sort();
        api('cohort.create', { data: { name: nm.value, language: data.language || 'en', startDate: ds[0] || '', status: 'Planned', notes: 'Created from the draft “' + (name.value || d.name) + '”' },
          structure: { blocks: blocks, sessions: sched.sessions } }).then(function (res) { m.close(); toast('Cohort created'); S.planner = null; refreshBoot().then(function () { go('c/' + res.id + '/settings'); }); }).catch(fail);
      })],
    });
  }
  draw();
  window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
}
