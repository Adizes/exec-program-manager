/* ===================================================================================
 * LEARNER PAGES (no login), in the cohort language
 *   ?c=<cohort token>[&e=email] → registration form (all personal data)
 *   ?t=<personal token>          → Goals & intentions
 * =================================================================================== */
var LT = {
  en: {
    regTitle: 'Registration', regIntro: 'Please complete your registration for the Adizes Executive Program. Fields marked * are required. If you already registered, sending the form again with the same email updates your data.',
    goalsTitle: 'Goals and intentions', goalsIntro: 'Help us prepare your experience in the Adizes Executive Program. It takes about 10 minutes; you can come back to this link to update your answers.',
    about: 'About you', first: 'First name', last: 'Last name', email: 'Email', company: 'Company', job: 'Job title', profile: 'Which describes you best?', profileHint: 'Choose all that apply.',
    birthday: 'Birthday', phone: 'Phone (WhatsApp)', linkedin: 'LinkedIn profile', address: 'Mailing address', addressHint: 'Street, number, city, postal code, country.',
    save: 'Send', saving: 'Sending…', regDone: 'Thank you! Your registration is complete.', regDoneSub: 'We will be in touch with the next steps.',
    done: 'Thank you! Your answers are saved.', doneSub: 'You can open this link again any time to update them.', again: 'Edit my answers',
    required: 'Please complete the required fields', updated: 'Last updated', cohort: 'Cohort', optional: 'optional',
  },
  es: {
    regTitle: 'Inscripción', regIntro: 'Completa tu inscripción al Adizes Executive Program. Los campos con * son obligatorios. Si ya te inscribiste, enviar el formulario de nuevo con el mismo correo actualiza tus datos.',
    goalsTitle: 'Objetivos e intenciones', goalsIntro: 'Ayúdanos a preparar tu experiencia en el Adizes Executive Program. Toma unos 10 minutos; puedes volver a este enlace para actualizar tus respuestas.',
    about: 'Sobre ti', first: 'Nombre', last: 'Apellidos', email: 'Correo', company: 'Empresa', job: 'Puesto', profile: '¿Qué te describe mejor?', profileHint: 'Elige todas las que apliquen.',
    birthday: 'Fecha de nacimiento', phone: 'Teléfono (WhatsApp)', linkedin: 'Perfil de LinkedIn', address: 'Dirección postal', addressHint: 'Calle, número, ciudad, código postal y país.',
    save: 'Enviar', saving: 'Enviando…', regDone: '¡Gracias! Tu inscripción quedó completa.', regDoneSub: 'Te contactaremos con los siguientes pasos.',
    done: '¡Gracias! Tus respuestas quedaron guardadas.', doneSub: 'Puedes abrir este enlace cuando quieras para actualizarlas.', again: 'Editar mis respuestas',
    required: 'Completa los campos obligatorios', updated: 'Última actualización', cohort: 'Generación', optional: 'opcional',
  },
};
var PROFILE_ES = { 'Senior Executive': 'Alta dirección', 'Startup Founder': 'Fundador(a) de startup', 'Board Member': 'Miembro de consejo', 'Consultant': 'Consultor(a)', 'Scholar': 'Académico(a)', 'Independent Professionals': 'Profesional independiente', 'HR Manager': 'Recursos Humanos' };

function learnerShell(root, L, title, cohortName, content) {
  var card = h('.epm-lf-card',
    h('.epm-lf-head', h('img', { src: (CFG.assets || ASSETS) + 'adizes-logo-white.png', alt: 'Adizes Institute', width: '110', height: '37' }), h('span', 'Adizes Executive Program')),
    h('.epm-lf-body', title ? h('h1', title) : null, cohortName ? h('p.epm-muted', L.cohort + ': ' + cohortName) : null, content));
  clear(root).appendChild(h('.epm-lf', card));
  return card;
}
function learnerError(root, e) {
  learnerShell(root, LT.en, '', '', h('p', e.message));
}

function learnerApp(root) {
  var q = new URLSearchParams(location.search);
  var c = q.get('c'), t = q.get('t') || (location.hash.match(/t=([^&]+)/) || [])[1] || '';
  clear(root).appendChild(h('.epm-lf', h('.epm-loading.epm-center', '…')));
  if (c) return api('reg.get', { c: c, e: q.get('e') || '' }, { noToken: true }).then(function (d) { registrationForm(root, d, c); }).catch(function (e) { learnerError(root, e); });
  api('learner.get', { t: t }, { noToken: true }).then(function (d) { goalsForm(root, d, t); }).catch(function (e) { learnerError(root, e); });
}

function registrationForm(root, d, token) {
  var L = LT[d.lang] || LT.en, p = d.prefill || {};
  var req = function (label) { return label + ' *'; };
  var F = {
    firstName: inputEl(p.firstName, { autocomplete: 'given-name', required: true }), lastName: inputEl(p.lastName, { autocomplete: 'family-name', required: true }),
    email: inputEl(p.email, { type: 'email', autocomplete: 'email', required: true }),
    company: inputEl(p.company, { autocomplete: 'organization', required: true }), jobTitle: inputEl(p.jobTitle, { autocomplete: 'organization-title', required: true }),
    birthday: inputEl(p.birthday, { type: 'date', autocomplete: 'bday', required: true }), phone: inputEl(p.phone, { type: 'tel', autocomplete: 'tel', required: true }),
    linkedin: inputEl(p.linkedin, { type: 'url', placeholder: 'https://www.linkedin.com/in/…' }), address: textareaEl(p.address, { rows: 2, autocomplete: 'street-address' }),
  };
  var prof = h('.epm-checks', d.profileOptions.map(function (o) { return h('label.epm-check', h('input', { type: 'checkbox', value: o, checked: (p.profile || []).indexOf(o) >= 0 }), h('span', d.lang === 'es' ? (PROFILE_ES[o] || o) : o)); }));
  var hp = h('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true', class: 'epm-hp' });
  var msg = h('p.epm-lf-msg', { role: 'status' });
  var form = h('form.epm-lf-form', { onsubmit: submit, novalidate: true },
    h('h2', L.about),
    h('.epm-row2', field(req(L.first), F.firstName), field(req(L.last), F.lastName)),
    field(req(L.email), F.email),
    h('.epm-row2', field(req(L.company), F.company), field(req(L.job), F.jobTitle)),
    field(req(L.profile), prof, L.profileHint),
    h('.epm-row2', field(req(L.birthday), F.birthday), field(req(L.phone), F.phone)),
    field(L.linkedin + ' (' + L.optional + ')', F.linkedin), field(L.address + ' (' + L.optional + ')', F.address, L.addressHint),
    hp, msg, h('button.epm-btn.epm-btn-primary.epm-btn-lg', { type: 'submit' }, L.save));
  var card = learnerShell(root, L, L.regTitle, d.cohort, [h('p', L.regIntro), form]);
  document.documentElement.lang = d.lang;
  function submit(e) {
    e.preventDefault();
    var profile = {}; Object.keys(F).forEach(function (k) { profile[k] = F[k].value.trim(); });
    profile.profile = Array.prototype.slice.call(prof.querySelectorAll('input:checked')).map(function (i) { return i.value; });
    var bad = (d.required || []).filter(function (k) { return !profile[k]; });
    Object.keys(F).forEach(function (k) { F[k].classList.toggle('epm-invalid', bad.indexOf(k) >= 0); });
    prof.classList.toggle('epm-invalid', !profile.profile.length);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(profile.email)) { bad.push('email'); F.email.classList.add('epm-invalid'); }
    if (bad.length || !profile.profile.length) { msg.textContent = L.required; var f = form.querySelector('.epm-invalid'); if (f && f.focus) f.focus(); return; }
    var b = form.querySelector('button[type=submit]'); b.disabled = true; b.textContent = L.saving; msg.textContent = '';
    api('reg.save', { c: token, profile: profile, hp: hp.value }, { noToken: true }).then(function () {
      clear(card.lastChild).appendChild(h('.epm-lf-done', h('.epm-lf-check', icon('check', 28)), h('h1', L.regDone), h('p', L.regDoneSub)));
      window.scrollTo(0, 0);
    }).catch(function (err) { msg.textContent = /missing/.test(err.code || '') ? L.required : err.message; b.disabled = false; b.textContent = L.save; });
  }
}

function goalsForm(root, d, token) {
  var L = LT[d.lang] || LT.en;
  var goals = d.questions.map(function (q, i) { return textareaEl(d.goals[i], { rows: 3 }); });
  var msg = h('p.epm-lf-msg', { role: 'status' });
  var form = h('form.epm-lf-form', { onsubmit: submit },
    d.questions.map(function (q, i) { return field((i + 1) + '. ' + q, goals[i]); }), msg,
    h('button.epm-btn.epm-btn-primary.epm-btn-lg', { type: 'submit' }, L.save));
  var card = learnerShell(root, L, L.goalsTitle, d.cohort, [h('p', (d.firstName ? d.firstName + ', ' : '') + L.goalsIntro),
    d.submittedAt ? h('p.epm-small.epm-muted', L.updated + ': ' + new Date(d.submittedAt).toLocaleDateString(d.lang)) : null, form]);
  document.documentElement.lang = d.lang;
  function submit(e) {
    e.preventDefault();
    var b = form.querySelector('button[type=submit]'); b.disabled = true; b.textContent = L.saving; msg.textContent = '';
    api('learner.save', { t: token, goals: goals.map(function (g) { return g.value; }) }, { noToken: true }).then(function () {
      clear(card.lastChild).appendChild(h('.epm-lf-done', h('.epm-lf-check', icon('check', 28)), h('h1', L.done), h('p', L.doneSub),
        h('button.epm-btn.epm-btn-ghost', { type: 'button', onclick: function () { learnerApp(root); } }, L.again)));
      window.scrollTo(0, 0);
    }).catch(function (err) { msg.textContent = err.message; b.disabled = false; b.textContent = L.save; });
  }
}
