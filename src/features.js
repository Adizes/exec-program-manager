/* ===================================================================================
 * FEATURES — registration link, CSV imports (weekly feedback, calendar), SME reminders,
 * email templates, test sends and the PDF progress report
 * =================================================================================== */

/* ------------------------------- shared: test send ------------------------------- */
// A "Send test to me" button. send(test=true) must return a promise.
function testBtn(send) {
  return btn('Send test to me', { icon: 'mail', kind: 'ghost', title: 'Sends this email only to you, marked [TEST]' }, function () {
    send(true).then(function (r) { toast('Test sent to ' + ((r && r.to) || S.user.email)); }).catch(fail);
  });
}

/* ------------------------------- registration link ------------------------------- */
function registrationModal(ctx) {
  var link = h('input.epm-input', { readOnly: true, value: ctx.C.registrationLink || '' });
  var m = modal('Registration form · ' + ctx.C.cohort.name, [
    h('p.epm-p', 'Share this link with new participants. They fill in all their data (in ' + (ctx.C.cohort.language === 'es' ? 'Spanish' : 'English') +
      '); if someone answers again with the same email, their data is updated — never their PAEI or Lifecycle.'),
    field('Link', link),
    h('.epm-actions', btn('Copy link', { icon: 'copy', kind: 'primary' }, function () { copyText(link.value); }),
      h('a.epm-btn.epm-btn-ghost', { href: link.value, target: '_blank', rel: 'noopener' }, icon('ext'), h('span', 'Open form')),
      btn('Email it to learners…', { icon: 'mail', kind: 'ghost' }, function () { m.close(); emailComposer(ctx, [], 'registration'); })),
    h('.epm-card.epm-card-flat', h('h4', 'New link'), h('p.epm-small.epm-muted', 'Creates a new link and turns off the current one (for example, if it was shared by mistake).'),
      btn('Generate a new link', { icon: 'sync', kind: 'danger-ghost' }, function () {
        confirmBox('Generate a new link?', 'The current link stops working immediately.', 'Generate', true).then(function (ok) {
          if (!ok) return;
          api('cohort.regLink', { cohortId: ctx.id, regenerate: true }).then(function (r) { link.value = r.link; ctx.C.registrationLink = r.link; delete S.cohorts[ctx.id]; toast('New link ready'); }).catch(fail);
        });
      }))], { wide: true });
}

/* ------------------------------- weekly feedback CSV ------------------------------- */
// "11/10/2026" (month/day, as Google Sheets exports in the US), "10/11/2026" when the first part > 12, or ISO
function parseSheetDate(s) {
  s = String(s || '').trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    var a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000;
    var mo = a > 12 ? b : a, d = a > 12 ? a : b;
    return y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
  }
  return parseCalDate(s);
}

function parseWeeklyCsv(text, M) {
  var rows = parseCsv(text).filter(function (r) { return r.some(function (x) { return x !== ''; }); });
  var hi = rows.findIndex(function (r) { var l = r.map(function (x) { return x.toLowerCase(); }); return l.some(function (x) { return /^date/.test(x); }) && l.some(function (x) { return /^name/.test(x); }); });
  if (hi < 0) throw new Error('Could not find the header row (Date, Name, Module, SME, …).');
  var H = rows[hi].map(function (x) { return x.toLowerCase(); });
  var col = function (re) { for (var i = 0; i < H.length; i++) if (re.test(H[i])) return i; return -1; };
  var cDate = col(/^date/), cName = col(/^name/), cMod = col(/^module/), cSme = col(/^sme/);
  var cQ = [1, 2, 3, 4, 5].map(function (n) { var c = col(new RegExp('^' + n + '\\.')); return c >= 0 ? c : cSme + n; });
  var cImp = col(/^6\.|improve/), cCom = col(/^7\.|comment/);
  var learners = M.enrollments.map(function (e) { return M.learner[e.email]; }).filter(Boolean);
  var out = { records: [], unmatched: {}, noSession: 0, anonymous: 0 };
  rows.slice(hi + 1).forEach(function (r) {
    var qs = cQ.map(function (c) { var v = Number(String(r[c] || '').replace(',', '.')); return r[c] !== '' && !isNaN(v) ? v : null; });
    if (!qs.some(function (v) { return v != null; })) return;
    var name = (r[cName] || '').trim(), date = parseSheetDate(r[cDate]);
    var rec = { date: date, q1: qs[0], q2: qs[1], q3: qs[2], q4: qs[3], q5: qs[4], smeName: cSme >= 0 ? r[cSme] : '', improve: cImp >= 0 ? r[cImp] : '', comments: cCom >= 0 ? r[cCom] : '' };
    if (!name || /^(unknown|uknown|anonymous|an[oó]nimo)$/i.test(name)) { out.anonymous++; rec.nameRaw = ''; }
    else {
      var best = null, bs = 0;
      learners.forEach(function (l) { var sc = nameScore(name, fullName(l)); if (sc > bs) { bs = sc; best = l; } });
      if (best && bs >= 0.8) rec.email = best.email; else { rec.nameRaw = name; out.unmatched[name] = (out.unmatched[name] || 0) + 1; }
    }
    // session: same date; otherwise the closest session (±4 days) of the block named in "Module" ("3. CAPI")
    var s = M.C.sessions.find(function (x) { return x.date === date; });
    var num = String(r[cMod] || '').match(/^\s*(\d+)/);
    var blk = num ? M.C.blocks.find(function (b) { return b.kind === 'course' && b.number === num[1]; }) : null;
    if (!s && blk && date) {
      var near = (M.blockSessions[blk.id] || []).filter(function (x) { return x.date && Math.abs((pd(x.date) - pd(date)) / 864e5) <= 4; });
      s = near[0];
    }
    if (s) { rec.sessionId = s.id; rec.blockId = s.blockId; } else { out.noSession++; if (blk) rec.blockId = blk.id; }
    out.records.push(rec);
  });
  return out;
}

function weeklyCsvModal(ctx) {
  var file = h('input', { type: 'file', accept: '.csv,text/csv' });
  var out = h('div', h('p.epm-muted', 'In the Weekly Feedback sheet: File → Download → Comma-separated values (.csv), then choose the file here.'));
  var parsed = null;
  file.addEventListener('change', function () {
    var f = file.files[0]; if (!f) return;
    f.text().then(function (txt) {
      try { parsed = parseWeeklyCsv(txt, ctx.M); } catch (e) { parsed = null; clear(out); out.appendChild(h('p.epm-t-low', e.message)); return; }
      clear(out);
      var un = Object.keys(parsed.unmatched);
      append(out, [
        h('.epm-kpis', kpi('Responses in the file', String(parsed.records.length)), kpi('Now in the platform', String((ctx.C.weeklyFeedback || []).length)),
          kpi('Without a session', String(parsed.noSession), parsed.noSession ? 'Kept with their date' : null, parsed.noSession ? 'mid' : null)),
        un.length ? h('div', h('h4', 'Names not matched to a learner (' + un.length + ')'), h('p.epm-small.epm-muted', 'They are kept with the name as written.'),
          h('p', un.map(function (n) { return badge(n + ' × ' + parsed.unmatched[n], 'muted'); }))) : h('p.epm-small', badge('Every name matched a learner', 'good')),
        parsed.anonymous ? h('p.epm-small.epm-muted', parsed.anonymous + ' anonymous responses.') : null]);
    });
  });
  var m = modal('Import session feedback (CSV)', [field('CSV file', file), out,
    h('p.epm-small.epm-muted', 'The file replaces ALL the session feedback of ' + ctx.C.cohort.name + ' (including what was captured by hand).')], {
    wide: true,
    footer: [btn('Cancel', { kind: 'ghost' }, function () { m.close(); }), btn('Replace session feedback', { kind: 'primary', icon: 'upload' }, function () {
      if (!parsed || !parsed.records.length) return toast('Choose a CSV with responses first', 'error');
      confirmBox('Replace the session feedback?', (ctx.C.weeklyFeedback || []).length + ' current responses will be replaced by ' + parsed.records.length + ' from the file.', 'Replace', true).then(function (ok) {
        if (!ok) return;
        api('weekly.replace', { cohortId: ctx.id, records: parsed.records }).then(function (r) { m.close(); toast(r.added + ' responses imported'); ctx.reload(); }).catch(fail);
      });
    })],
  });
}

/* ------------------------------- calendar CSV (program calendar template) ------------------------------- */
var MONTH_IDX = { jan: 0, ene: 0, feb: 1, mar: 2, apr: 3, abr: 3, may: 4, jun: 5, jul: 6, aug: 7, ago: 7, sep: 8, set: 8, oct: 9, nov: 10, dec: 11, dic: 11 };
// "7 Sep 26", "07 Sept 2026", "2026-09-07", "9/7/2026"
function parseCalDate(s) {
  s = String(s || '').trim();
  var m = s.match(/^(\d{1,2})[\s-]+([A-Za-zÁÉÍÓÚáéíóú]{3,})\.?[\s-]+(\d{2,4})$/);
  if (m) {
    var mi = MONTH_IDX[m[2].slice(0, 3).toLowerCase()]; if (mi == null) return '';
    var y = +m[3]; if (y < 100) y += 2000;
    return iso(new Date(Date.UTC(y, mi, +m[1])));
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? iso(new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]))) : '';
}
function calBlockKind(t) {
  t = normName(t);
  if (/^welcome|^bienvenida/.test(t)) return 'welcome';
  if (/case stud|caso/.test(t)) return 'case_study';
  if (/wrap|graduation|graduaci|cierre/.test(t)) return 'wrapup';
  if (/recap|summariz/.test(t)) return 'other';
  return 'course';
}
// Reads the "PROGRAM STUDENT CALENDAR" sheet (Week | Live session dates | Course + SME | Module No. | Module)
function calendarFromCsv(text) {
  var rows = parseCsv(text);
  var hi = rows.findIndex(function (r) { return r.some(function (x) { return /^course/i.test(x); }) && r.some(function (x) { return /^module/i.test(x); }); });
  if (hi < 0) throw new Error('This does not look like the program calendar (no Course / Module columns).');
  var H = rows[hi].map(function (x) { return x.trim().toLowerCase(); });
  var cCourse = H.findIndex(function (x) { return /^course/.test(x); });
  var cNo = H.findIndex(function (x) { return /^module\s*no|^no\.?$/.test(x); });
  var cMod = H.findIndex(function (x, i) { return /^module/.test(x) && i !== cNo; });
  var dateCols = []; for (var i = 1; i < cCourse; i++) dateCols.push(i);
  var blocks = [], sessions = [], cur = null, nCourse = 0, nCs = 0, warnings = [];
  rows.slice(hi + 1).forEach(function (r) {
    var dates = dateCols.map(function (c) { return parseCalDate(r[c]); }).filter(Boolean);
    var course = String(r[cCourse] || '').trim(), mod = String(r[cMod] || '').trim(), no = String(r[cNo] || '').trim();
    if (!dates.length) return;                                     // breaks, notes, empty lines
    if (/onboarding/i.test(course + ' ' + mod)) return;            // no live session
    if (course) {
      var lines = course.split(/\n/).map(function (x) { return x.trim(); }).filter(Boolean);
      var title = lines[0], sme = lines.slice(1).join(' ');
      var kind = calBlockKind(title);
      if (!(cur && normName(cur._raw) === normName(title))) {       // same title after a break = same block
        var number = kind === 'course' ? String(++nCourse) : kind === 'case_study' ? 'CS' + (++nCs) : kind === 'welcome' ? '0' : kind === 'wrapup' ? 'W' : '';
        cur = { key: 'k' + blocks.length, _raw: title, kind: kind, number: number,
          title: kind === 'welcome' ? 'Welcome' : kind === 'case_study' ? 'Case Study ' + nCs : kind === 'wrapup' ? 'Wrap-Up' : title,
          smeName: sme, smeEmail: matchSmeEmail(sme), smeSeesFeedback: true };
        blocks.push(cur);
      } else if (sme && !cur.smeName) { cur.smeName = sme; cur.smeEmail = matchSmeEmail(sme); }
    }
    if (!cur) { warnings.push('Row without a course: ' + mod); return; }
    var moduleNo = cur.kind === 'wrapup' ? '' : (no === '0' && cur.kind !== 'welcome' ? '' : no);
    dates.forEach(function (d) { sessions.push({ blockKey: cur.key, date: d, moduleNo: moduleNo, moduleTitle: mod }); });
  });
  blocks.forEach(function (b) { delete b._raw; });
  if (!sessions.length) throw new Error('No session dates found in the file.');
  return { blocks: blocks, sessions: sessions, warnings: warnings };
}
function readCalendarFile(input) {
  var f = input.files[0];
  if (!f) return Promise.reject(new Error('Choose the CSV of the Calendar sheet'));
  return f.text().then(calendarFromCsv);
}
function structureSummary(st) {
  var ds = st.sessions.map(function (s) { return s.date; }).filter(Boolean).sort();
  return st.blocks.length + ' blocks · ' + st.sessions.length + ' sessions' + (ds.length ? ' · ' + fmtDate(ds[0]) + ' → ' + fmtDate(ds[ds.length - 1]) : '');
}

/* ------------------------------- SME reminder ------------------------------- */
function smeReminderModal(ctx, b) {
  var T = (S.boot.emailTemplates || {}).smeReminder || {};
  var lang = ctx.C.cohort.language === 'es' ? 'es' : 'en';
  var ss = (ctx.M.blockSessions[b.id] || []).filter(function (s) { return s.date; });
  var first = ss.length ? ss[0].date : '';
  var due = first ? addDays(first, -7) : '';
  var pending = T[lang] && T[lang].pending;
  var m = modal('Reminder to the SME · ' + b.title, [
    h('dl.epm-dl', [['SME', smeLabel(b) || '—'], ['Email', b.smeEmail || 'No account — assign the SME in Settings → Structure'], ['First session', first ? fmtDate(first, true) : '—'],
      ['Automatic reminder', b.reminderSentAt ? 'Sent ' + fmtDateTime(b.reminderSentAt) : (due ? 'Will be sent on ' + fmtDate(due, true) + ' (one week before)' : '—')],
      ['Teachable curriculum', b.teachableCourseId ? String(ctx.C.curriculumUrl || '').replace('{id}', b.teachableCourseId) : 'No Teachable course ID']].map(function (r) { return [h('dt', r[0]), h('dd', r[1])]; })),
    pending ? h('p.epm-small', badge('Template text pending', 'mid'), ' Write it in Settings → Email templates; until then nothing is sent automatically.') : null], {
    footer: [testBtn(function () { return api('sme.remind', { blockId: b.id, test: true }); }), h('.epm-spacer'), btn('Close', { kind: 'ghost' }, function () { m.close(); }),
      btn(b.reminderSentAt ? 'Send again' : 'Send now', { kind: 'primary', icon: 'mail', disabled: !b.smeEmail || pending }, function () {
        confirmBox('Send the reminder to ' + (smeLabel(b) || b.smeEmail) + '?', 'It goes to ' + b.smeEmail + '.', 'Send').then(function (ok) {
          if (ok) api('sme.remind', { blockId: b.id }).then(function () { m.close(); toast('Reminder sent'); ctx.reload(); }).catch(fail);
        });
      })],
  });
}

/* ------------------------------- email templates (Settings) ------------------------------- */
function templatesCard() {
  var T = S.boot.emailTemplates || {};
  var keys = Object.keys(T).filter(function (k) { return k !== 'custom'; });
  var key = selectEl(keys.map(function (k) { return { value: k, label: T[k].label + (T[k].pending ? ' · text pending' : '') }; }), keys[0]);
  var lang = selectEl([{ value: 'en', label: 'English' }, { value: 'es', label: 'Spanish' }], 'en');
  var subject = inputEl(''), body = textareaEl('', { rows: 10 }), cta = inputEl('', { placeholder: 'Button text (only when the email has a link)' });
  var vars = h('p.epm-small.epm-muted'), state = h('span');
  function load() {
    var t = T[key.value], v = t[lang.value];
    subject.value = v.subject; body.value = v.body; cta.value = v.cta || '';
    vars.textContent = 'Placeholders: ' + t.vars.map(function (x) { return '{' + x + '}'; }).join('  ') + (t.to === 'sme' ? ' · sent to the SME' : ' · sent to the learner');
    clear(state).appendChild(v.pending ? badge('Pending — cannot be sent yet', 'mid') : v.custom ? badge('Edited', 'good') : badge('Default text', 'muted'));
  }
  key.addEventListener('change', load); lang.addEventListener('change', load);
  load();
  return h('.epm-card', h('.epm-card-head', h('h3', 'Email templates'), state),
    h('p.epm-small.epm-muted', 'Every email leaves from execprogram@adizes.com in the cohort language. Write the text here; {placeholders} are filled in for each person.'),
    h('.epm-row2', field('Template', key), field('Language', lang)),
    field('Subject', subject), field('Message', body, 'Leave an empty line between paragraphs. Links are clickable.'), field('Button', cta), vars,
    h('.epm-actions',
      btn('Save template', { kind: 'primary' }, function () {
        api('templates.save', { key: key.value, lang: lang.value, subject: subject.value, body: body.value, cta: cta.value }).then(function (r) { T = S.boot.emailTemplates = r.templates; load(); toast('Template saved'); }).catch(fail);
      }),
      testBtn(function () { return api('templates.test', { key: key.value, lang: lang.value, subject: subject.value, body: body.value, cta: cta.value }); }),
      btn('Back to default text', { kind: 'ghost' }, function () {
        confirmBox('Go back to the default text?', 'Your version of this template will be deleted.', 'Reset', true).then(function (ok) {
          if (ok) api('templates.save', { key: key.value, lang: lang.value, reset: true }).then(function (r) { T = S.boot.emailTemplates = r.templates; load(); toast('Default text restored'); }).catch(fail);
        });
      })));
}

/* ------------------------------- books code email ------------------------------- */
function booksCodeEmail(ctx, l) {
  if (!l.booksCode) return toast(ERRORS.invalid_no_books_code, 'error');
  var T = (S.boot.emailTemplates || {}).booksCode || {};
  var lang = ctx.C.cohort.language === 'es' ? 'es' : 'en';
  var pending = T[lang] && T[lang].pending;
  var send = function (test) { return api('email.send', { cohortId: ctx.id, template: 'booksCode', emails: [l.email], test: test }); };
  var m = modal('Email the books code', [h('p.epm-p', 'To ', h('b', fullName(l)), ' (' + l.email + ') · code ', h('b', l.booksCode)),
    pending ? h('p.epm-small', badge('Template text pending', 'mid'), ' Write it in Settings → Email templates.') : h('p.epm-small.epm-muted', 'Uses the “Books code” template in ' + (lang === 'es' ? 'Spanish' : 'English') + '. It is logged in Conversations.')], {
    footer: [testBtn(send), h('.epm-spacer'), btn('Cancel', { kind: 'ghost' }, function () { m.close(); }), btn('Send', { kind: 'primary', icon: 'mail', disabled: pending }, function () {
      send(false).then(function (r) { if (r.failed.length) return toast(errText(r.failed[0].error), 'error'); m.close(); toast('Books code sent'); delete S.cohorts[ctx.id]; }).catch(fail);
    })],
  });
}

/* ------------------------------- PDF progress report ------------------------------- */
var REPORT_TXT = {
  en: { title: 'PROGRAM PROGRESS REPORT', participant: 'Participant', cohort: 'Cohort', date: 'Report date', current: 'Current course', journey: 'PROGRAM JOURNEY',
    completed: 'Completed', currentL: 'Current', upcoming: 'Upcoming', attendance: 'ATTENDANCE', lms: 'LMS PROGRESS', sessionsAtt: 'sessions attended', rating: 'EXPERIENCE RATING',
    ratingNote: 'Average of your ratings in the live session feedback surveys', noRating: 'No ratings submitted yet', byCourse: 'PROGRESS BY COURSE', course: 'Course', feedback: 'Feedback',
    submitted: 'Submitted', notSubmitted: 'Not submitted', na: 'Not yet applicable', comments: 'Comments', none: '—',
    defaultComment: 'Remember to review the course content in Teachable before each live session: it makes the sessions richer and more meaningful. As the program progresses the content becomes more technical, so preparation is increasingly important.\n\nPlease reach out if you need any help accessing the materials.' },
  es: { title: 'REPORTE DE AVANCE DEL PROGRAMA', participant: 'Participante', cohort: 'Generación', date: 'Fecha del reporte', current: 'Curso actual', journey: 'RECORRIDO DEL PROGRAMA',
    completed: 'Completado', currentL: 'Actual', upcoming: 'Próximo', attendance: 'ASISTENCIA', lms: 'AVANCE EN EL LMS', sessionsAtt: 'sesiones con asistencia', rating: 'CALIFICACIÓN DE LA EXPERIENCIA',
    ratingNote: 'Promedio de tus calificaciones en las encuestas de cada sesión en vivo', noRating: 'Aún no hay calificaciones', byCourse: 'AVANCE POR CURSO', course: 'Curso', feedback: 'Feedback',
    submitted: 'Enviado', notSubmitted: 'No enviado', na: 'Aún no aplica', comments: 'Comentarios', none: '—',
    defaultComment: 'Recuerda revisar el contenido del curso en Teachable antes de cada sesión en vivo: así las sesiones son más ricas y significativas. Conforme avanza el programa el contenido se vuelve más técnico, por lo que la preparación es cada vez más importante.\n\nEscríbenos si necesitas ayuda para acceder a los materiales.' },
};
function loadScriptOnce(url, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  return new Promise(function (res, rej) {
    var sc = document.createElement('script'); sc.src = url; sc.async = true;
    sc.onload = function () { res(window[globalName]); }; sc.onerror = function () { rej(new Error('Could not load the PDF library')); };
    document.head.appendChild(sc);
  });
}
function imageData(url) {
  return fetch(url).then(function (r) { if (!r.ok) throw new Error(); return r.blob(); }).then(function (b) {
    return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.readAsDataURL(b); });
  }).catch(function () { return null; });
}
// Everything the report shows, from the cohort bundle
function reportData(ctx, email) {
  var M = ctx.M, C = ctx.C, l = M.learner[email], st = M.stats[email], t = today();
  var e = M.enr[email];
  var blocks = C.blocks.map(function (b) {
    var ds = (M.blockSessions[b.id] || []).map(function (s) { return s.date; }).filter(Boolean).sort();
    var status = !ds.length ? 'upcoming' : ds[ds.length - 1] < t ? 'completed' : ds[0] <= t ? 'current' : 'upcoming';
    return { b: b, first: ds[0], last: ds[ds.length - 1], status: status };
  });
  var current = blocks.find(function (x) { return x.status === 'current'; }) || blocks.filter(function (x) { return x.status === 'completed'; }).pop();
  var courses = blocks.filter(function (x) { return x.b.kind === 'course'; }).map(function (x) {
    var a = st.attByBlock[x.b.id], lp = (M.lms[email] || {})[x.b.id];
    var fb = (C.moduleFeedback || []).some(function (f) { return f.email === email && f.blockId === x.b.id; });
    return { n: x.b.number, title: x.b.title, started: x.status !== 'upcoming', att: a && a.t ? a.p / a.t : null, lms: lp ? (lp.p || 0) / 100 : null,
      feedback: fb ? 'yes' : x.status === 'completed' ? 'no' : 'na' };
  });
  var journey = blocks.filter(function (x) { return ['welcome', 'course', 'case_study', 'wrapup'].indexOf(x.b.kind) >= 0; }).map(function (x) {
    return { label: x.b.kind === 'welcome' ? 'W' : x.b.kind === 'course' ? 'C' + x.b.number : x.b.kind === 'case_study' ? x.b.number : 'END', status: x.status };
  });
  return { name: fullName(l), cohort: C.cohort.name + (C.cohort.code ? ' · ' + C.cohort.code : ''), current: current ? blockLabel(current.b) : '—',
    att: st.att, present: st.present, total: st.total, lms: st.lms, rating: st.exp, courses: courses, journey: journey, status: e ? e.status : '' };
}
function buildReportPdf(ctx, email, comment) {
  var lang = ctx.C.cohort.language === 'es' ? 'es' : 'en', L = REPORT_TXT[lang];
  var D = reportData(ctx, email);
  var lib = CFG.jspdfUrl || 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  return Promise.all([loadScriptOnce(lib, 'jspdf'), imageData((CFG.assets || ASSETS) + 'adizes-logo-white.png')]).then(function (res) {
    var jsPDF = res[0].jsPDF, logo = res[1];
    var doc = new jsPDF({ unit: 'mm', format: 'a4' });
    var W = 210, X = 16, IW = W - 2 * X;
    var RED = [215, 20, 26], INK = [20, 20, 20], MUTED = [110, 110, 110], LINE = [225, 225, 222], GOOD = [29, 122, 53], TRACK = [236, 236, 234];
    var col = function (c) { doc.setTextColor(c[0], c[1], c[2]); };
    var fill = function (c) { doc.setFillColor(c[0], c[1], c[2]); };
    var draw = function (c) { doc.setDrawColor(c[0], c[1], c[2]); };
    // header
    fill([17, 17, 17]); doc.rect(0, 0, W, 26, 'F'); fill(RED); doc.rect(0, 26, W, 1.6, 'F');
    if (logo) { try { doc.addImage(logo, 'PNG', X, 7, 34, 11.5); } catch (e) { /* ignore */ } }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); col([255, 255, 255]); doc.text(L.title, W - X, 16, { align: 'right' });
    // info
    var y = 38;
    var info = [[L.participant, D.name], [L.cohort, D.cohort], [L.current, D.current]];
    info.forEach(function (r, i) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); col(MUTED); doc.text(r[0].toUpperCase(), X, y + i * 7.5);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); col(INK); doc.text(String(r[1] || '—'), X + 38, y + i * 7.5);
    });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); col(MUTED); doc.text(L.date.toUpperCase(), W - X - 40, y, { align: 'left' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); col(INK); doc.text(fmtDate(today()), W - X, y, { align: 'right' });
    // journey
    y = 68; section(L.journey, y); y += 10;
    var n = D.journey.length, step = n > 1 ? IW / (n - 1) : 0;
    draw(LINE); doc.setLineWidth(0.6); if (n > 1) doc.line(X, y, X + IW, y);
    D.journey.forEach(function (j, i) {
      var cx = X + i * step;
      if (j.status === 'completed') { fill(INK); doc.circle(cx, y, 2.2, 'F'); }
      else if (j.status === 'current') { fill([255, 255, 255]); draw(RED); doc.setLineWidth(0.9); doc.circle(cx, y, 2.6, 'FD'); fill(RED); doc.circle(cx, y, 1.1, 'F'); }
      else { fill([255, 255, 255]); draw([170, 170, 166]); doc.setLineWidth(0.5); doc.circle(cx, y, 2.2, 'FD'); }
      doc.setFont('helvetica', j.status === 'current' ? 'bold' : 'normal'); doc.setFontSize(7.5); col(j.status === 'upcoming' ? MUTED : INK);
      doc.text(j.label, cx, y + 7, { align: 'center' });
    });
    var ly = y + 13, lx = W / 2 - 42;
    [[L.completed, 'completed'], [L.currentL, 'current'], [L.upcoming, 'upcoming']].forEach(function (k, i) {
      var cx = lx + i * 30;
      if (k[1] === 'completed') { fill(INK); doc.circle(cx, ly - 1, 1.4, 'F'); }
      else if (k[1] === 'current') { fill([255, 255, 255]); draw(RED); doc.setLineWidth(0.7); doc.circle(cx, ly - 1, 1.6, 'FD'); }
      else { fill([255, 255, 255]); draw([170, 170, 166]); doc.setLineWidth(0.4); doc.circle(cx, ly - 1, 1.4, 'FD'); }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); col(MUTED); doc.text(k[0], cx + 3, ly);
    });
    // attendance + lms cards
    y = 101;
    var cw = (IW - 8) / 2;
    card(X, y, cw, L.attendance, D.att, D.total ? D.present + ' / ' + D.total + ' ' + L.sessionsAtt : L.none);
    card(X + cw + 8, y, cw, L.lms, D.lms, '');
    // rating
    y = 136; section(L.rating, y); y += 9;
    if (D.rating != null) {
      for (var s = 0; s < 5; s++) star(W / 2 - 22 + s * 8, y, 3.1, Math.max(0, Math.min(1, D.rating - s)));
      doc.setFont('helvetica', 'bold'); doc.setFontSize(16); col(INK); doc.text(num(D.rating), W / 2 + 22, y + 2, { align: 'left' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); col(MUTED); doc.text(L.ratingNote, W / 2, y + 9, { align: 'center' });
    } else { doc.setFont('helvetica', 'normal'); doc.setFontSize(10); col(MUTED); doc.text(L.noRating, W / 2, y + 2, { align: 'center' }); }
    // table
    y = 163; section(L.byCourse, y); y += 7;
    var cols = [X, X + 9, X + 84, X + 120, X + IW];   // # | course | attendance | feedback | lms
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); col(MUTED);
    doc.text('#', cols[0] + 1, y); doc.text(L.course.toUpperCase(), cols[1], y); doc.text(L.attendance, cols[2], y); doc.text(L.feedback.toUpperCase(), cols[3], y); doc.text(L.lms, cols[4], y, { align: 'right' });
    y += 2.5; draw(LINE); doc.setLineWidth(0.3); doc.line(X, y, X + IW, y);
    D.courses.forEach(function (c) {
      y += D.courses.length > 8 ? 6.4 : 7.2;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); col(c.started ? INK : MUTED);
      doc.text(String(c.n), cols[0] + 1, y); doc.text(doc.splitTextToSize(c.title, cols[2] - cols[1] - 4)[0], cols[1], y);
      miniBar(cols[2], y, c.started ? c.att : null);
      if (c.feedback === 'yes') { check(cols[3] + 2, y - 1.2); doc.setFontSize(8); col(GOOD); doc.text(L.submitted, cols[3] + 6, y); }
      else { doc.setFontSize(8); col(MUTED); doc.text(c.feedback === 'no' ? L.notSubmitted : L.na, cols[3], y); }
      miniBar(cols[4] - 33, y, c.lms, true);
      draw([240, 240, 238]); doc.setLineWidth(0.2); doc.line(X, y + 2.6, X + IW, y + 2.6);
    });
    // comments
    if (comment && comment.trim()) {
      y += 11;
      var lines = doc.splitTextToSize(comment.trim(), IW - 10);
      var hgt = Math.min(lines.length, 12) * 4.3 + 12;
      if (y + hgt > 286) { doc.addPage(); y = 20; }
      draw(LINE); doc.setLineWidth(0.3); fill([250, 250, 248]); doc.roundedRect(X, y, IW, hgt, 2, 2, 'FD');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); col(INK); doc.text(L.comments, X + 5, y + 6.5);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.8); col([50, 50, 50]); doc.text(lines.slice(0, 12), X + 5, y + 12);
    }
    // footer
    var pages = doc.getNumberOfPages();
    for (var p = 1; p <= pages; p++) {
      doc.setPage(p); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); col(MUTED);
      doc.text('Adizes Institute · Adizes Executive Program', X, 290); doc.text(p + ' / ' + pages, W - X, 290, { align: 'right' });
    }
    return { doc: doc, filename: (lang === 'es' ? 'Reporte de avance - ' : 'Progress report - ') + D.name + '.pdf' };

    function section(label, yy) {
      fill([17, 17, 17]); doc.rect(X, yy - 4.6, IW, 6.6, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); col([255, 255, 255]); doc.text(label, W / 2, yy - 0.3, { align: 'center' });
    }
    function card(x, yy, w, label, v, sub) {
      draw(LINE); doc.setLineWidth(0.3); doc.roundedRect(x, yy, w, 24, 2, 2, 'S');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); col(MUTED); doc.text(label, x + 5, yy + 7);
      doc.setFontSize(15); col(v == null ? MUTED : (v >= 0.75 ? GOOD : v >= 0.4 ? [138, 90, 0] : RED)); doc.text(v == null ? '—' : Math.round(v * 100) + '%', x + w - 5, yy + 8, { align: 'right' });
      fill(TRACK); doc.roundedRect(x + 5, yy + 12, w - 10, 3.4, 1.2, 1.2, 'F');
      if (v) { fill(v >= 0.75 ? GOOD : v >= 0.4 ? [227, 160, 8] : RED); doc.roundedRect(x + 5, yy + 12, Math.max(2.4, (w - 10) * Math.min(1, v)), 3.4, 1.2, 1.2, 'F'); }
      if (sub) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8); col(MUTED); doc.text(sub, x + 5, yy + 21); }
    }
    function miniBar(x, yy, v, rightPct) {
      if (v == null) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8); col(MUTED); doc.text('—', x, yy); return; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); col(INK);
      doc.text(Math.round(v * 100) + '%', x, yy);
      fill(TRACK); doc.rect(x + 11, yy - 2.6, 22, 2.6, 'F');
      fill(v >= 0.75 ? GOOD : v >= 0.4 ? [227, 160, 8] : RED); if (v > 0) doc.rect(x + 11, yy - 2.6, 22 * Math.min(1, v), 2.6, 'F');
    }
    function check(x, yy) { draw(GOOD); doc.setLineWidth(0.7); doc.line(x - 1.4, yy, x - 0.3, yy + 1.1); doc.line(x - 0.3, yy + 1.1, x + 1.6, yy - 1.4); }
    function star(cx, cy, r, f) {
      var pts = []; for (var k = 0; k < 10; k++) { var a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.45 : r; pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]); }
      var poly = function (style) { var segs = pts.slice(1).map(function (p, i) { return [p[0] - pts[i][0], p[1] - pts[i][1]]; }); doc.lines(segs, pts[0][0], pts[0][1], [1, 1], style, true); };
      fill(TRACK); draw(TRACK); poly('F');
      if (f > 0) { fill([227, 160, 8]); draw([227, 160, 8]); if (f >= 0.99) poly('F'); else { doc.saveGraphicsState(); doc.rect(cx - r, cy - r, 2 * r * f, 2 * r, null); doc.clip(); doc.discardPath(); poly('F'); doc.restoreGraphicsState(); } }
    }
  });
}
function reportModal(ctx, email) {
  var C = ctx.C, l = ctx.M.learner[email];
  var lang = C.cohort.language === 'es' ? 'es' : 'en', L = REPORT_TXT[lang];
  var T = ((S.boot.emailTemplates || {}).progressReport || {})[lang] || {};
  var comment = textareaEl(L.defaultComment, { rows: 5 });
  var subject = inputEl(T.subject || ''), body = textareaEl(T.body || '', { rows: 6 });
  var make = function () { return buildReportPdf(ctx, email, comment.value); };
  var send = function (test) {
    return make().then(function (r) {
      var b64 = r.doc.output('datauristring').split(',')[1];
      return api('report.send', { cohortId: ctx.id, email: email, pdfBase64: b64, filename: r.filename, subject: subject.value, body: body.value, test: test });
    });
  };
  var m = modal('Progress report · ' + fullName(l), [
    h('p.epm-p', 'Generated with today’s data, in ' + (lang === 'es' ? 'Spanish' : 'English') + '. Generate it again any time to update it.'),
    field('Comments for the learner (in the report)', comment),
    h('.epm-actions', btn('Download PDF', { icon: 'down', kind: 'primary' }, function () { make().then(function (r) { r.doc.save(r.filename); }).catch(fail); }),
      btn('Preview', { icon: 'ext', kind: 'ghost' }, function () { make().then(function (r) { window.open(r.doc.output('bloburl'), '_blank'); }).catch(fail); })),
    h('.epm-card.epm-card-flat', h('h4', 'Email it to ' + l.email),
      field('Subject', subject), field('Message', body, '{first} and {cohort} are filled in. The PDF goes attached.'),
      h('.epm-actions', testBtn(send), btn('Send to the learner', { icon: 'mail', kind: 'primary' }, function () {
        confirmBox('Send the report to ' + fullName(l) + '?', 'It goes to ' + l.email + ' with the PDF attached, and is logged in Conversations.', 'Send').then(function (ok) {
          if (ok) send(false).then(function () { m.close(); toast('Report sent'); delete S.cohorts[ctx.id]; }).catch(fail);
        });
      })))], { wide: true });
}
