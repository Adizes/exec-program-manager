// End-to-end: real bundle in Chromium against the local server (real Code.gs with fake Google services).
// IMPORT_DIR=/path/to/json npm test   → runs with real cohort data. Screenshots in test/out/.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { start } from './server.mjs';

const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch (e) { pw = require('/opt/npm-tools/node_modules/playwright'); }
const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'out'); mkdirSync(OUT, { recursive: true });

const srv = await start({ port: 8799 });
// Program calendar CSV: CAL_CSV=/path/to/Calendar.csv, otherwise a small synthetic one
let CAL = process.env.CAL_CSV;
if (!CAL || !existsSync(CAL)) {
  CAL = join(OUT, 'calendar.csv');
  writeFileSync(CAL, [',,PROGRAM STUDENT CALENDAR - Test,,,', 'Week ,Live Session,,Course ,Module No.,Modules', ',Date,Date,,,',
    ',,26 Aug 26,Onboarding,0,Onboarding', ',,2 Sep 26,Welcome ,0,Welcome to the program',
    'Week 1,7 Sep 26,9 Sep 26,"Introduction to the Methodology\nShoham",1,The Conceptual Map',
    'Week 2,14 Sep 26,16 Sep 26,"Management Styles\nAlex",2.1,Change',
    'Week 3,21 Sep 26,23 Sep 26,,2.2,Roles', 'Week 4,28 Sep 26,30 Sep 26,"Case Study\nSam",CS.1,Analyzing Case Study - 1',
    ',Holidays Break Weeks,,,,', ',,,,,', 'Week 5,12 Oct 26,14 Oct 26,"Management Styles\nAlex",2.3,Leadership',
    'Week 6,19 Oct 26,21 Oct 26,"Lifecycles\nShoham",3.1,Early stages', 'Week 7,26 Oct 26,28 Oct 26,,3.2,Late stages',
    'Week 8,2 Nov 26,4 Nov 26,Wrap-up,0,Q&A and Graduation'].join('\n'));
}
const URL0 = srv.url;
const browser = await pw.chromium.launch();
const errors = [];
let passed = 0;
let current = null;
const step = async (name, fn) => {
  if (current) await current.evaluate(() => document.querySelectorAll('.epm-overlay').forEach(o => o.remove())).catch(() => {});
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.error('  ✗', name, '\n', e.message); process.exitCode = 1; }
};
const watch = (page) => {
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
};
const shot = (page, name) => page.screenshot({ path: join(OUT, name + '.png'), fullPage: false });
const codeFor = async (email) => {
  const mails = await (await fetch(URL0 + '/__emails')).json();
  const m = mails.reverse().find(x => x.to === email);
  return m.subject.match(/(\d{6})/)[1];
};
async function signIn(page, email) {
  await page.goto(URL0 + '/');
  await page.fill('input[type=email]', email);
  await page.click('text=Send me a code');
  await page.waitForSelector('input[autocomplete=one-time-code]', { state: 'visible' });
  await page.fill('input[autocomplete=one-time-code]', await codeFor(email));
  await page.click('button:has-text("Sign in")');
  await page.waitForSelector('.epm-top');
}
const topOverlay = (page) => page.locator('.epm-overlay').last();
const lastEmail = async () => (await (await fetch(URL0 + '/__emails')).json()).pop();
const csvCell = (v) => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
const noHScroll = async (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1);
const idle = (page) => page.waitForFunction(() => !document.querySelector('.epm-progress.on'), null, { timeout: 15000 });

const hasData = srv.G.post({ action: 'bootstrap', token: srv.pmToken }).cohorts.length > 0;
if (!hasData) {
  // minimal data: one cohort from the template with three learners
  const b = srv.G.post({ action: 'bootstrap', token: srv.pmToken });
  const blocks = b.template.map((x, i) => ({ key: 'k' + i, kind: x.kind, number: x.number, title: x.title, smeName: x.smeName, teachableCourseId: x.kind === 'course' ? String(3000 + i) : '' }));
  const sessions = []; let d = new Date('2026-09-07T12:00:00Z');
  b.template.forEach((x, i) => x.modules.forEach(m => { for (let k = 0; k < m.sessions; k++) { sessions.push({ blockKey: 'k' + i, date: d.toISOString().slice(0, 10), moduleNo: m.no, moduleTitle: m.title }); d = new Date(d.getTime() + (k ? 5 : 2) * 864e5); } }));
  const c = srv.G.post({ action: 'cohort.create', token: srv.pmToken, data: { name: 'Cohort 6', language: 'en', status: 'Active' }, structure: { blocks, sessions } });
  srv.G.post({ action: 'learner.add', token: srv.pmToken, cohortId: c.id, people: [{ email: 'fernando@x.com', firstName: 'Fernando', lastName: 'Rodriguez' }, { email: 'julia@x.com', firstName: 'Julia', lastName: 'Aboytes' }, { email: 'liliana@x.com', firstName: 'Liliana', lastName: 'Aguilar' }] });
  srv.G.post({ action: 'cohort.update', token: srv.pmToken, id: c.id, patch: { status: 'Active' } });
}
const cohorts = srv.G.post({ action: 'bootstrap', token: srv.pmToken }).cohorts;
const C6 = cohorts.find(c => c.name === 'Cohort 6') || cohorts[0];
const C4 = cohorts.find(c => c.name === 'Cohort 4') || C6;

console.log('desktop · Program Manager');
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage(); watch(page); current = page;

await step('sign in with emailed code', async () => { await signIn(page, 'dani@adizes.com'); await page.waitForSelector('.epm-ccard'); await shot(page, '01-cohorts'); });
await step('Webflow global CSS does not leak (button font size stays 13px)', async () => {
  const fs = await page.$eval('.epm-btn', el => getComputedStyle(el).fontSize);
  assert.equal(fs, '13px');
});
await step('cohort overview', async () => {
  await page.click(`a.epm-ccard[href="#/c/${C4.id}/overview"]`);
  await page.waitForSelector('.epm-kpis'); await page.waitForTimeout(300); await shot(page, '02-overview');
  if (C4.name === 'Cohort 4') assert.equal(await page.$$eval('.epm-legend-i', x => x.length), 2, 'two lines: in program + attended');
  const bullets = await page.$$eval('.epm-risk li', lis => lis.map(li => getComputedStyle(li).listStyleType));
  assert.ok(bullets.every(b => b === 'none'), 'no bullets from the site CSS');
});
await step('learners table + learner panel', async () => {
  await page.click('a.epm-tab:has-text("Learners")'); await page.waitForSelector('.epm-table-click tbody tr');
  await shot(page, '03-learners');
  await page.click('.epm-table-click tbody tr >> nth=0'); await page.waitForSelector('.epm-drawer');
  await page.waitForTimeout(250); await shot(page, '04-learner-drawer');
  await page.click('.epm-drawer a:has-text("Program")'); await page.waitForSelector('text=Move to another cohort');
  await page.keyboard.press('Escape');
});
await step('calendar + edit a session', async () => {
  await page.click('a.epm-tab:has-text("Calendar")'); await page.waitForSelector('.epm-block');
  await shot(page, '05-calendar');
  await page.click('.epm-block tr.epm-clickable >> nth=0');
  await page.fill('.epm-modal textarea >> nth=0', 'What is your favorite city?');
  await page.click('.epm-modal button:has-text("Save")'); await idle(page);
  await page.waitForSelector('text=What is your favorite city?');
});
await step('attendance grid: toggle a cell saves', async () => {
  await page.click('a.epm-tab:has-text("Attendance")'); await page.waitForSelector('.epm-att-table');
  await shot(page, '06-attendance');
  if (C4.name === 'Cohort 4') assert.ok((await page.$$('.epm-att.na')).length > 10, 'sessions after a drop-out are not counted');
  const before = srv.G.sheet('Attendance').rows.length;
  await page.click('.epm-att-table tbody tr:first-child td.epm-att button >> nth=0');
  await page.waitForSelector('.epm-toast:has-text("Attendance saved")', { timeout: 10000 });
  assert.ok(srv.G.sheet('Attendance').rows.length >= before - 1);
});
await step('LMS sync with Teachable', async () => {
  await page.click('a.epm-tab:has-text("LMS")'); await page.click('button:has-text("Sync now")');
  await page.waitForSelector('.epm-toast:has-text("Synced")', { timeout: 15000 }); await page.waitForSelector('.epm-table-click');
  await page.click('.epm-table-click tbody tr >> nth=0'); await page.waitForSelector('.epm-details, .epm-modal .epm-empty');
  await page.click('.epm-details summary >> nth=0').catch(() => {});
  await shot(page, '07-lms-detail'); await page.keyboard.press('Escape');
});
await step('weekly feedback capture', async () => {
  await page.click('a.epm-tab:has-text("Feedback")'); await page.waitForSelector('text=Capture feedback');
  await shot(page, '08-feedback');
  await page.click('button:has-text("Capture feedback")');
  for (let q = 0; q < 5; q++) await page.click(`.epm-modal .epm-scale >> nth=${q} >> button >> nth=4`);
  await page.click('.epm-modal button:has-text("Save & add another")'); await page.waitForSelector('.epm-toast:has-text("Saved")');
  await page.waitForTimeout(1500);
  assert.ok(await page.$('.epm-modal h3:has-text("Capture session feedback")'), 'the next entry form stays open');
  await page.keyboard.press('Escape'); await idle(page);
});
await step('weekly feedback: CSV import replaces everything', async () => {
  const Cx = srv.G.post({ action: 'cohort.get', token: srv.pmToken, id: C6.id });
  const held = Cx.sessions.filter(x => x.date && x.date <= new Date().toISOString().slice(0, 10)).slice(-3);
  const L = Cx.learners.slice(0, 3);
  const lines = [['Weekly Feedback'], ['Date', 'Name', 'Module', 'SME', '1. Program content', '2. SMEs', '3. Technical', '4. Pace', '5. Community', '6. What would you improve?', '7. Comments']];
  held.forEach((x, i) => L.forEach((l, j) => lines.push([x.date.slice(5, 7) + '/' + x.date.slice(8) + '/' + x.date.slice(0, 4), l.firstName + ' ' + l.lastName, '', 'Someone', 5, 4, 3 + (j % 3), 4, 5, i ? '' : 'More cases', 'Great'])));
  lines.push([held[0].date, 'Unknown', '', '', 4, 4, 4, 4, 4, '', '']);
  writeFileSync(join(OUT, 'weekly.csv'), lines.map(r => r.map(csvCell).join(',')).join('\n'));
  await page.goto(URL0 + '/#/c/' + C6.id + '/feedback'); await page.waitForSelector('button:has-text("Import CSV")');
  await page.click('button:has-text("Import CSV")');
  await page.setInputFiles('.epm-modal input[type=file]', join(OUT, 'weekly.csv'));
  await page.waitForSelector('.epm-modal .epm-kpis'); await shot(page, '08b-weekly-csv');
  await page.click('.epm-modal button:has-text("Replace session feedback")');
  await topOverlay(page).locator('button:has-text("Replace")').click();
  await page.waitForSelector('.epm-toast:has-text("responses imported")'); await idle(page);
  const W = srv.G.post({ action: 'cohort.get', token: srv.pmToken, id: C6.id }).weeklyFeedback;
  assert.equal(W.length, held.length * L.length + 1);
  assert.ok(W.filter(w => w.email).length === held.length * L.length, 'names matched to learners');
});
await step('weekly feedback: delete a response (confirm dialog)', async () => {
  const count = () => srv.G.post({ action: 'cohort.get', token: srv.pmToken, id: C6.id }).weeklyFeedback.length;
  const before = count();
  await page.click('.epm-details summary >> nth=0').catch(() => {});
  await page.click('button[aria-label="Edit"] >> nth=0');
  await page.click('.epm-modal button:has-text("Delete")');
  await topOverlay(page).locator('button:has-text("Delete")').click();
  await page.waitForFunction(() => !document.querySelector('.epm-overlay')); await idle(page);
  assert.equal(count(), before - 1);
});
await step('conversations: bulk log', async () => {
  await page.click('a.epm-tab:has-text("Conversations")'); await page.waitForSelector('button:has-text("Log conversation")');
  await page.click('button:has-text("Log conversation")');
  await page.click('.epm-modal .epm-check-all input');
  await page.click('.epm-modal label.epm-check:has-text("Whatsapp") input');
  await page.click('.epm-modal label.epm-check:has-text("Books") input');
  await page.fill('.epm-modal textarea >> nth=0', 'Sent the books code');
  await page.click('.epm-modal button:has-text("Save")');
  await page.waitForSelector('.epm-toast:has-text("conversations logged")');
  await idle(page); await shot(page, '09-conversations');
});
await step('structure editor', async () => {
  await page.click('a.epm-tab:has-text("Settings")'); await page.waitForSelector('.epm-sblock');
  await page.evaluate(() => document.querySelector('.epm-sblock').scrollIntoView()); await shot(page, '10-structure');
  await page.click('button:has-text("Reschedule dates")'); await page.click('.epm-modal button:has-text("Apply")');
  await page.waitForSelector('.epm-toast:has-text("rescheduled")');
});

await step('Zoom CSV import matches by name and saves', async () => {
  await page.goto(URL0 + '/#/c/' + C6.id + '/attendance'); await page.waitForSelector('button:has-text("Import Zoom CSV")');
  const Cx = srv.G.post({ action: 'cohort.get', token: srv.pmToken, id: C6.id });
  const ls = Cx.learners.slice(0, 3);
  const s = Cx.sessions.find(x => x.date) || Cx.sessions[0];
  const [y, mo, da] = s.date.split('-');
  const csv = 'Meeting ID,Topic,Start Time,End Time,User Email,Duration (Minutes),Participants\n' +
    `"867 1234",Exec Program,${mo}/${da}/${y} 08:00:00 AM,${mo}/${da}/${y} 09:30:00 AM,host@adizes.com,90,4\n\n` +
    'Name (Original Name),User Email,Join Time,Leave Time,Duration (Minutes),Guest\n' +
    `Dani Carrillo,dani@adizes.com,${mo}/${da}/${y} 07:58:00 AM,${mo}/${da}/${y} 09:30:00 AM,92,No\n` +
    `${ls[0].firstName} ${ls[0].lastName},,${mo}/${da}/${y} 08:01:00 AM,${mo}/${da}/${y} 09:30:00 AM,89,Yes\n` +
    `${(ls[1].firstName || '').toUpperCase()} (iPhone),,${mo}/${da}/${y} 08:05:00 AM,${mo}/${da}/${y} 08:20:00 AM,15,Yes\n` +
    `Mystery Guest,,${mo}/${da}/${y} 08:05:00 AM,${mo}/${da}/${y} 09:20:00 AM,75,Yes\n`;
  const f = join(OUT, 'zoom.csv'); writeFileSync(f, csv);
  await page.click('button:has-text("Import Zoom CSV")');
  await page.setInputFiles('.epm-modal input[type=file]', f);
  await page.waitForSelector('.epm-modal h4:has-text("not matched")');
  const sel = await page.$eval('.epm-modal select >> nth=0', el => el.value);
  assert.equal(sel, s.id, 'session auto-selected by date');
  await shot(page, '11-zoom-import');
  await page.click('.epm-modal button:has-text("Save attendance")');
  await page.waitForSelector('.epm-toast:has-text("marks saved")');
  const att = srv.G.post({ action: 'cohort.get', token: srv.pmToken, id: C6.id }).attendance.filter(a => a.s === s.id);
  assert.equal(att.find(a => a.e === ls[0].email).v, 'Present');
  assert.equal(att.find(a => a.e === ls[2].email).v, 'Absent');
});

await step('new cohort wizard from template', async () => {
  await page.goto(URL0 + '/#/cohorts'); await page.click('button:has-text("New cohort")');
  await page.fill('.epm-modal input >> nth=0', 'Cohort 9');
  assert.equal(await page.$eval('.epm-modal select:has(option[value=csv])', x => x.value), 'csv', 'the calendar CSV is the default source');
  await page.selectOption('.epm-modal select:has(option[value=csv])', 'template');
  await page.fill('.epm-modal input[type=date] >> nth=0', '2027-01-06');
  await page.fill('.epm-modal input[type=date] >> nth=1', '2027-01-11');
  await page.fill('.epm-modal textarea', '2027-04-01');
  await page.dispatchEvent('.epm-modal textarea', 'change');
  await page.waitForFunction(() => /sessions · /.test(document.querySelector('.epm-modal .epm-small.epm-muted:last-child')?.textContent || '') || /→/.test(document.querySelector('.epm-modal-body')?.textContent || ''));
  await shot(page, '12-new-cohort');
  await page.click('.epm-modal button:has-text("Create cohort")');
  await page.waitForSelector('.epm-sblock', { timeout: 15000 });
});

await step('new cohort wizard from the calendar CSV', async () => {
  await page.goto(URL0 + '/#/cohorts'); await page.click('button:has-text("New cohort")');
  await page.fill('.epm-modal input >> nth=0', 'Cohort 10');
  await page.setInputFiles('.epm-modal input[type=file]', CAL);
  await page.waitForFunction(() => /blocks · \d+ sessions/.test(document.querySelector('.epm-modal-body')?.textContent || ''));
  await shot(page, '12b-new-cohort-csv');
  await page.click('.epm-modal button:has-text("Create cohort")');
  await page.waitForSelector('.epm-sblock', { timeout: 15000 });
  const c = srv.G.post({ action: 'bootstrap', token: srv.pmToken }).cohorts.find(x => x.name === 'Cohort 10');
  const Cx = srv.G.post({ action: 'cohort.get', token: srv.pmToken, id: c.id });
  assert.ok(Cx.sessions.length >= 10 && Cx.sessions.every(x => x.date), 'sessions with dates');
  assert.ok(Cx.blocks.some(b => b.kind === 'case_study') && Cx.blocks.some(b => b.kind === 'welcome'));
  assert.ok(Cx.blocks.every(b => b.smeSeesFeedback === true), 'SMEs see feedback by default');
  assert.ok(!Cx.blocks.some(b => /onboarding/i.test(b.title)), 'onboarding is skipped');
});
await step('structure editor: import calendar CSV keeps Teachable IDs', async () => {
  const c = srv.G.post({ action: 'bootstrap', token: srv.pmToken }).cohorts.find(x => x.name === 'Cohort 10');
  await page.goto(URL0 + '/#/c/' + c.id + '/settings'); await page.waitForSelector('.epm-sblock');
  await page.click('button:has-text("Import calendar CSV")');
  await page.setInputFiles('.epm-modal input[type=file]', CAL);
  await page.waitForFunction(() => /blocks · /.test(document.querySelector('.epm-modal-body')?.textContent || ''));
  await page.click('.epm-modal button:has-text("Use this calendar")');
  await page.waitForSelector('.epm-toast:has-text("Calendar loaded")');
});
await step('remove enrollment really removes the learner', async () => {
  const c = srv.G.post({ action: 'bootstrap', token: srv.pmToken }).cohorts.find(x => x.name === 'Cohort 10');
  srv.G.post({ action: 'learner.add', token: srv.pmToken, cohortId: c.id, people: [{ email: 'remove.me@x.com', firstName: 'Remove', lastName: 'Me' }] });
  await page.goto(URL0 + '/#/c/' + c.id + '/learners'); await page.reload(); await page.waitForSelector('.epm-table-click tbody tr');
  await page.click('.epm-table-click tbody tr:has-text("Remove Me")'); await page.waitForSelector('.epm-drawer');
  await page.click('.epm-drawer a:has-text("Program")');
  await page.click('button:has-text("Remove enrollment")');
  await topOverlay(page).locator('button:has-text("Remove")').click();
  await page.waitForFunction(() => !document.querySelector('.epm-drawer')); await idle(page);
  const Cx = srv.G.post({ action: 'cohort.get', token: srv.pmToken, id: c.id });
  assert.ok(!Cx.enrollments.some(e => e.email === 'remove.me@x.com'));
});
await step('add learners: rows only, no email is sent', async () => {
  const c = srv.G.post({ action: 'bootstrap', token: srv.pmToken }).cohorts.find(x => x.name === 'Cohort 10');
  await page.goto(URL0 + '/#/c/' + c.id + '/learners'); await page.click('button:has-text("Add learners")'); await page.waitForSelector('.epm-modal input[type=email]');
  assert.equal(await page.$$eval('.epm-modal textarea', x => x.length), 0, 'no paste box');
  const n = (await (await fetch(URL0 + '/__emails')).json()).length;
  await page.fill('.epm-modal input[type=email] >> nth=0', 'new.person@x.com');
  await page.fill('.epm-modal input >> nth=1', 'New'); await page.fill('.epm-modal input >> nth=2', 'Person');
  await page.click('.epm-modal button:has-text("Add learners")');
  await page.waitForFunction(() => !document.querySelector('.epm-overlay'), null, { timeout: 15000 }); await idle(page);
  assert.ok(srv.G.post({ action: 'cohort.get', token: srv.pmToken, id: c.id }).enrollments.some(e => e.email === 'new.person@x.com'), 'added');
  assert.equal((await (await fetch(URL0 + '/__emails')).json()).length, n, 'nothing emailed');
});
await step('registration link modal', async () => {
  const c = srv.G.post({ action: 'bootstrap', token: srv.pmToken }).cohorts.find(x => x.name === 'Cohort 10');
  await page.goto(URL0 + '/#/c/' + c.id + '/learners'); await page.click('button:has-text("Registration form")');
  await page.waitForSelector('.epm-modal input[readonly]');
  assert.match(await page.$eval('.epm-modal input[readonly]', x => x.value), /exec-program-profile\?c=/);
  await shot(page, '16-registration-link');
});
await step('SME reminder: test send', async () => {
  await page.goto(URL0 + '/#/c/' + C6.id + '/calendar'); await page.waitForSelector('.epm-block');
  const b = page.locator('.epm-block-meta button').first();
  if (await b.count()) {
    await b.click(); await page.waitForSelector('.epm-modal');
    await shot(page, '17-sme-reminder');
    await page.click('.epm-modal button:has-text("Send test to me")');
    await page.waitForSelector('.epm-toast:has-text("Test sent")');
    assert.match((await lastEmail()).subject, /^\[TEST\]/);
  }
});
await step('progress report PDF: download and test email', async () => {
  await page.goto(URL0 + '/#/c/' + C6.id + '/learners'); await page.waitForSelector('.epm-table-click tbody tr');
  await page.click('.epm-table-click tbody tr >> nth=0'); await page.waitForSelector('.epm-drawer');
  await page.click('button:has-text("Progress report (PDF)")'); await page.waitForSelector('.epm-modal:has-text("Progress report")');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('.epm-modal button:has-text("Download PDF")')]);
  const pdfPath = join(OUT, 'report.pdf'); await dl.saveAs(pdfPath);
  assert.ok(readFileSync(pdfPath).slice(0, 4).toString() === '%PDF');
  await shot(page, '18-report-modal');
  const n0 = srv.G.state.emails.length;
  await page.click('.epm-modal button:has-text("Send test to me")');
  for (let i = 0; i < 80 && srv.G.state.emails.length === n0; i++) await page.waitForTimeout(250);
  const m = await lastEmail(); assert.match(m.subject, /^\[TEST\]/); assert.ok(m.attachments === 1, 'PDF attached');
});
await step('email templates: edit and send test', async () => {
  await page.goto(URL0 + '/#/settings'); await page.waitForSelector('h3:has-text("Email templates")');
  await page.locator('.epm-card:has(h3:has-text("Email templates"))').scrollIntoViewIfNeeded(); await shot(page, '15b-templates');
  await page.locator('.epm-card:has(h3:has-text("Email templates")) button:has-text("Send test to me")').click();
  await page.waitForSelector('.epm-toast:has-text("Test sent")');
});
await step('planner: timeline, month and SME availability', async () => {
  await page.goto(URL0 + '/#/planner'); await page.waitForSelector('.epm-gantt-bar');
  await page.waitForTimeout(200); await shot(page, '50-planner-timeline');
  await page.click('a.epm-tab:has-text("Month")'); await page.waitForSelector('.epm-month-day');
  await shot(page, '51-planner-month');
  await page.click('a.epm-tab:has-text("SME availability")'); await page.waitForSelector('.epm-gantt');
  await page.click('button:has-text("Add time off")');
  await page.selectOption('.epm-modal select', 'shoham@adizes.com');
  await page.fill('.epm-modal input[type=date] >> nth=0', '2027-01-18'); await page.fill('.epm-modal input[type=date] >> nth=1', '2027-01-22');
  await page.fill('.epm-modal input >> nth=2', 'Conference');
  await page.click('.epm-modal button:has-text("Save")'); await page.waitForSelector('.epm-gantt-off');
  await shot(page, '52-planner-smes');
});
await step('planner: draft a cohort, reorder, check conflicts, create it', async () => {
  await page.click('a.epm-tab:has-text("Cohort drafts")'); await page.click('button:has-text("New draft")');
  await page.waitForSelector('.epm-dtable');
  await page.fill('.epm-deditor input >> nth=0', 'Cohort 11 draft');
  await page.fill('.epm-deditor input[type=date] >> nth=0', '2027-01-06');
  await page.fill('.epm-deditor input[type=date] >> nth=1', '2027-01-11'); await page.dispatchEvent('.epm-deditor input[type=date] >> nth=1', 'change');
  await page.waitForSelector('.epm-dtable td:has-text("Jan 27")');
  const t1 = await page.$$eval('.epm-dtable tbody tr td:nth-child(2) input', x => x.map(i => i.value));
  await page.click('.epm-dtable tbody tr >> nth=2 >> button[aria-label="Move up"]');
  const t2 = await page.$$eval('.epm-dtable tbody tr td:nth-child(2) input', x => x.map(i => i.value));
  assert.equal(t2[1], t1[2], 'course moved up');
  // Shoham on a course that runs in his time off → conflict
  await page.selectOption('.epm-dtable tbody tr >> nth=3 >> td:nth-child(3) select', 'shoham@adizes.com');
  await page.waitForSelector('.epm-deditor .epm-gantt');
  await shot(page, '53-planner-draft');
  await page.click('button:has-text("Save draft")'); await page.waitForSelector('.epm-toast:has-text("Draft saved")');
  await page.click('button:has-text("Create cohort from this draft")');
  await page.fill('.epm-modal input', 'Cohort 11'); await page.click('.epm-modal button:has-text("Create")');
  await page.waitForSelector('.epm-sblock', { timeout: 15000 });
  const c = srv.G.post({ action: 'bootstrap', token: srv.pmToken }).cohorts.find(x => x.name === 'Cohort 11');
  const Cx = srv.G.post({ action: 'cohort.get', token: srv.pmToken, id: c.id });
  assert.equal(Cx.blocks[1].title, t1[2]); assert.ok(Cx.sessions.every(x => x.date >= '2027-01-06'));
});
await step('SME performance chart', async () => {
  await page.goto(URL0 + '/#/smes'); await page.waitForSelector('.epm-toolbar select');
  await page.selectOption('.epm-toolbar select', 'shoham@adizes.com');
  await page.waitForSelector('.epm-svg, .epm-empty'); await page.waitForTimeout(300);
  const svg = await page.$('.epm-svg');
  if (svg) { const box = await svg.boundingBox(); await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2); }
  await shot(page, '13-sme');
  await page.waitForSelector('.epm-rcard'); await page.$eval('.epm-rcard', el => el.scrollIntoView({ block: 'center' }));
  await shot(page, '13b-sme-module-cards');
  await page.click('.epm-chart:has(.epm-rcards) button.epm-link'); await page.waitForSelector('.epm-chart th:has-text("Average")');
  await shot(page, '13c-sme-module-table');
});
await step('team & settings pages render', async () => {
  await page.goto(URL0 + '/#/team'); await page.waitForSelector('text=Invite person'); await shot(page, '14-team');
  await page.goto(URL0 + '/#/settings'); await page.waitForSelector('text=Import from the old Matrix sheets'); await shot(page, '15-settings');
  await page.goto(URL0 + '/#/learners'); await page.waitForSelector('.epm-chip');
});

console.log('learner link');
const learnerCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
const lp = await learnerCtx.newPage(); watch(lp);
await step('learner opens the personal link (mobile), saves goals', async () => {
  const Cx = srv.G.post({ action: 'cohort.get', token: srv.pmToken, id: C6.id });
  const l = Cx.learners[0];
  await lp.goto(URL0 + '/profile?t=' + l.profileLink.split('t=')[1]);
  await lp.waitForSelector('form.epm-lf-form');
  assert.ok(await noHScroll(lp), 'no horizontal scroll');
  await shot(lp, '20-learner-form');
  assert.equal(await lp.$$eval('form.epm-lf-form input', x => x.length), 0, 'goals only');
  await lp.fill('form.epm-lf-form textarea >> nth=0', 'Learn the methodology from the source');
  await lp.click('form.epm-lf-form button[type=submit]');
  await lp.waitForSelector('.epm-lf-done'); await shot(lp, '21-learner-done');
  const g = srv.G.post({ action: 'cohort.get', token: srv.pmToken, id: C6.id }).goals.find(x => x.email === l.email);
  assert.equal(g.a1, 'Learn the methodology from the source');
});
const spa = cohorts.find(c => c.language === 'es');
if (spa) await step('Spanish cohort → form in Spanish', async () => {
  const Cx = srv.G.post({ action: 'cohort.get', token: srv.pmToken, id: spa.id });
  await lp.goto(URL0 + '/profile?t=' + Cx.learners[0].profileLink.split('t=')[1]);
  await lp.waitForSelector('text=Objetivos e intenciones'); await shot(lp, '22-learner-es');
});
await step('registration form: required fields, then register and overwrite', async () => {
  const c = srv.G.post({ action: 'bootstrap', token: srv.pmToken }).cohorts.find(x => x.name === 'Cohort 10');
  const link = srv.G.post({ action: 'cohort.get', token: srv.pmToken, id: c.id }).registrationLink;
  const url = URL0 + '/profile?' + link.split('?')[1];
  await lp.goto(url); await lp.waitForSelector('form.epm-lf-form');
  assert.ok(await noHScroll(lp)); await shot(lp, '23-registration');
  await lp.click('form.epm-lf-form button[type=submit]'); await lp.waitForSelector('.epm-invalid');
  const fill = async (company) => {
    await lp.fill('input[autocomplete=given-name]', 'Ana'); await lp.fill('input[autocomplete=family-name]', 'Prueba');
    await lp.fill('input[type=email]', 'ana.prueba@x.com'); await lp.fill('input[autocomplete=organization]', company);
    await lp.fill('input[autocomplete=organization-title]', 'CEO'); await lp.fill('input[type=date]', '1985-04-02'); await lp.fill('input[type=tel]', '+52 55 1234 5678');
    if (!(await lp.isChecked('.epm-checks input >> nth=0'))) await lp.check('.epm-checks input >> nth=0');
  };
  await fill('Acme'); await lp.click('form.epm-lf-form button[type=submit]'); await lp.waitForSelector('.epm-lf-done'); await shot(lp, '24-registration-done');
  let Cx = srv.G.post({ action: 'cohort.get', token: srv.pmToken, id: c.id });
  assert.ok(Cx.enrollments.some(e => e.email === 'ana.prueba@x.com'), 'enrolled');
  srv.G.post({ action: 'learner.update', token: srv.pmToken, email: 'ana.prueba@x.com', patch: { P: '9', lifecycle: 'Adolescence' } });
  await lp.goto(url); await fill('Acme 2'); await lp.click('form.epm-lf-form button[type=submit]'); await lp.waitForSelector('.epm-lf-done');
  Cx = srv.G.post({ action: 'cohort.get', token: srv.pmToken, id: c.id });
  const l = Cx.learners.find(x => x.email === 'ana.prueba@x.com');
  assert.equal(l.company, 'Acme 2'); assert.equal(Cx.enrollments.filter(e => e.email === 'ana.prueba@x.com').length, 1, 'no duplicates');
});
await step('invalid link shows a message', async () => {
  await lp.goto(URL0 + '/profile?t=nope'); await lp.waitForSelector('text=not valid');
});

console.log('mobile · staff');
await step('cohorts and overview fit a phone', async () => {
  const mp = await learnerCtx.newPage(); watch(mp);
  await signIn(mp, 'execprogram@adizes.com');
  await mp.waitForSelector('.epm-ccard'); assert.ok(await noHScroll(mp), 'cohorts: no horizontal scroll'); await shot(mp, '30-mobile-cohorts');
  await mp.goto(URL0 + '/#/c/' + C4.id + '/overview'); await mp.waitForSelector('.epm-kpis'); await mp.waitForTimeout(300);
  assert.ok(await noHScroll(mp), 'overview: no horizontal scroll'); await shot(mp, '31-mobile-overview');
  await mp.goto(URL0 + '/#/c/' + C4.id + '/attendance'); await mp.waitForSelector('.epm-att-table');
  assert.ok(await noHScroll(mp), 'attendance: no horizontal page scroll'); await shot(mp, '32-mobile-attendance');
});

console.log('SME');
await step('SME sees only assigned cohorts and no conversations', async () => {
  const sc = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const sp = await sc.newPage(); watch(sp);
  await signIn(sp, 'shoham@adizes.com');
  await sp.waitForSelector('.epm-ccard, .epm-empty');
  const tabsText = await sp.$$eval('.epm-nav a', as => as.map(a => a.textContent));
  assert.deepEqual(tabsText, ['My cohorts', 'Planner', 'My ratings']);
  if (await sp.$('.epm-ccard')) {
    await sp.click('.epm-ccard >> nth=0'); await sp.waitForSelector('.epm-tabs');
    const t = await sp.$$eval('.epm-tab', as => as.map(a => a.textContent));
    assert.ok(!t.includes('Conversations') && !t.includes('Settings'));
    await sp.click('a.epm-tab:has-text("Learners")'); await sp.waitForSelector('.epm-table');
    await shot(sp, '40-sme-learners');
  }
  await sp.goto(URL0 + '/#/smes'); await sp.waitForSelector('.epm-card'); await sp.waitForTimeout(300); await shot(sp, '41-sme-ratings');
  await sp.goto(URL0 + '/#/planner/smes'); await sp.waitForSelector('.epm-gantt'); await shot(sp, '42-sme-planner');
  assert.equal(await sp.$$eval('a.epm-tab', x => x.filter(a => /drafts/i.test(a.textContent)).length), 0, 'no drafts for SMEs');
  await sc.close();
});

await step('no JavaScript errors', async () => { assert.deepEqual(errors, []); });
await browser.close();
srv.server.close();
console.log(`\n${passed} passed${process.exitCode ? ' · FAILURES' : ''}`);
