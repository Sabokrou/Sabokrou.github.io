import { SUPABASE_URL, SUPABASE_ANON_KEY } from './official-config.mjs';

const $ = id => document.getElementById(id);
const PANELS = ['setup-panel', 'auth-panel', 'claim-panel', 'student-panel', 'staff-panel'];
const VALID_OUTCOMES = new Set(['pass', 'revise', 'fail']);
let db, role, student, definitions = [], settings, roster = [], entries = [];
let selectedItemKey = '';
const edits = new Map();

function showPanel(id) {
  for (const panel of PANELS) $(panel).hidden = panel !== id;
  $('sign-out').hidden = id === 'setup-panel' || id === 'auth-panel';
}

function message(text, kind = '') {
  const box = $('site-message');
  box.textContent = text;
  box.className = `alert ${kind}`;
  box.hidden = !text;
}

function tellError(error, fallback = 'Could not complete this request. Please try again.') {
  console.error(error);
  message(error?.message || fallback, 'error');
}

function busy(button, work) {
  button.disabled = true;
  return Promise.resolve().then(work).finally(() => { button.disabled = false; });
}

function check({ data, error }) {
  if (error) throw error;
  return data;
}

function numeric(value) {
  return value === null || value === undefined || value === '' ? null : Number(value);
}

function roundPoints(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }
function format(value) { return roundPoints(value).toFixed(2); }

function outcomeLabel(value) {
  return value === 'pass' ? 'Pass' : value === 'fail' ? 'Fail' : value === 'revise' ? 'Revise' : 'Score posted';
}

function gradeFraction(entry, definition) {
  if (!entry?.published) return 0;
  const score = numeric(entry.score);
  if (score !== null) return Math.max(0, Math.min(1, score / Number(definition.max_score || 100)));
  return entry.outcome === 'pass' ? 1 : 0;
}

function released(entry) {
  return Boolean(entry?.published && (numeric(entry.score) !== null || VALID_OUTCOMES.has(entry.outcome)));
}

function pointsForStudent(allEntries) {
  const byKey = new Map(allEntries.map(entry => [entry.assessment_key, entry]));
  const labs = definitions.filter(item => item.category === 'lab');
  const other = definitions.filter(item => item.category !== 'lab');
  const top = labs.map(item => gradeFraction(byKey.get(item.key), item)).sort((a, b) => b - a);
  const bestCount = Number(settings?.labs_best_count ?? 9);
  const labWeight = Number(settings?.labs_weight ?? 15);
  const labPoints = top.slice(0, bestCount).reduce((sum, fraction) => sum + fraction, 0) * labWeight / bestCount;
  const otherPoints = other.reduce((sum, item) => sum + gradeFraction(byKey.get(item.key), item) * Number(item.weight), 0);
  const gradedLabs = labs.filter(item => released(byKey.get(item.key))).length;
  const gradedOther = other.filter(item => released(byKey.get(item.key))).length;
  const schemeComplete = labs.length === 12 && other.length === 6 && Math.abs(labWeight + other.reduce((sum, item) => sum + Number(item.weight), 0) - 100) < 0.001;
  return { total: labPoints + otherPoints, labPoints, gradedLabs, gradedOther, labs: labs.length, other: other.length, complete: schemeComplete && gradedLabs === labs.length && gradedOther === other.length };
}

function appendText(parent, tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function makePill(status) {
  const pill = document.createElement('span');
  pill.className = `result-pill ${VALID_OUTCOMES.has(status) ? status : ''}`;
  pill.textContent = outcomeLabel(status);
  return pill;
}

function renderStudent() {
  $('student-heading').textContent = student.full_name;
  $('student-meta').textContent = `${student.cohort || 'Course student'} · University ID ${student.university_id}`;
  const byKey = new Map(entries.map(entry => [entry.assessment_key, entry]));
  const result = pointsForStudent(entries);
  $('student-points').textContent = `${format(result.total)} / 100`;
  $('student-points-note').textContent = `${result.gradedLabs} of ${result.labs} labs and ${result.gradedOther} of ${result.other} other assessments released`;
  $('lab-points').textContent = `${format(result.labPoints)} / ${format(settings.labs_weight)} points`;
  $('student-bar').style.width = `${Math.max(0, Math.min(100, result.total))}%`;
  const target = numeric(settings.pass_threshold);
  $('student-target').textContent = target === null ? 'Not set' : `${format(target)} / 100`;
  $('student-target-note').textContent = target === null ? 'The instructor has not set the passing threshold.' : 'Set by the instructor';
  $('student-bar-target').hidden = target === null;
  if (target !== null) $('student-bar-target').style.left = `${target}%`;
  const progress = $('student-progress');
  const note = $('student-progress-note');
  const displayedTotal = roundPoints(result.total);
  if (target === null) {
    progress.textContent = 'In progress';
    note.textContent = 'A pass decision is unavailable until the mark is set.';
  } else if (!result.complete) {
    progress.textContent = displayedTotal >= target ? 'Pass line reached' : 'In progress';
    note.textContent = 'More results are still to be released; this is not a final decision.';
  } else {
    progress.textContent = displayedTotal >= target ? 'Pass' : 'Below pass mark';
    note.textContent = `All ${result.labs + result.other} results have been released.`;
  }

  const labGrid = $('student-labs');
  labGrid.replaceChildren();
  for (const item of definitions.filter(x => x.category === 'lab')) {
    const entry = byKey.get(item.key);
    const visible = released(entry);
    const card = document.createElement('article');
    card.className = `lab-card ${visible && VALID_OUTCOMES.has(entry.outcome) ? entry.outcome : ''}`;
    appendText(card, 'h4', item.label);
    appendText(card, 'div', visible ? outcomeLabel(entry.outcome) : 'Awaiting publication', 'lab-status');
    if (visible && numeric(entry.score) !== null) appendText(card, 'small', `${format(entry.score)} / ${format(item.max_score)}`);
    if (visible && entry.note) appendText(card, 'small', entry.note);
    labGrid.append(card);
  }
  const assessmentRows = $('student-assessments');
  assessmentRows.replaceChildren();
  for (const item of definitions.filter(x => x.category !== 'lab')) {
    const entry = byKey.get(item.key);
    const visible = released(entry);
    const row = document.createElement('tr');
    const name = document.createElement('td');
    appendText(name, 'strong', item.label);
    appendText(name, 'small', item.due_label || '', 'muted');
    row.append(name);
    appendText(row, 'td', `${format(item.weight)}%`);
    const grade = document.createElement('td');
    if (visible) {
      grade.append(makePill(entry.outcome));
      if (numeric(entry.score) !== null) appendText(grade, 'small', `${format(entry.score)} / ${format(item.max_score)}`);
      if (entry.note) appendText(grade, 'small', entry.note);
    } else appendText(grade, 'span', 'Awaiting publication', 'muted');
    row.append(grade);
    appendText(row, 'td', visible ? `${format(gradeFraction(entry, item) * Number(item.weight))} / ${format(item.weight)}` : '—');
    assessmentRows.append(row);
  }
}

async function loadStudent() {
  [definitions, settings, entries] = await Promise.all([
    db.from('assessment_definitions').select('*').order('sort_order').then(check),
    db.from('grading_settings').select('*').eq('id', 1).single().then(check),
    db.from('grade_entries').select('*').then(check)
  ]);
  renderStudent();
  showPanel('student-panel');
}

function entryFor(studentId, key) {
  return entries.find(entry => entry.student_id === studentId && entry.assessment_key === key);
}

async function fetchAllStaffGrades() {
  const pageSize = 1000;
  const all = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = check(await db.from('grade_entries').select('*')
      .order('student_id').order('assessment_key')
      .range(offset, offset + pageSize - 1));
    all.push(...page);
    if (page.length < pageSize) return all;
  }
}

function currentRow(studentId, key) {
  const identity = `${studentId}:${key}`;
  return edits.get(identity) || entryFor(studentId, key) || { student_id: studentId, assessment_key: key, outcome: null, score: null, published: false };
}

function listVisibleStudents() {
  const query = $('staff-search').value.trim().toLocaleLowerCase();
  const group = $('staff-group').value;
  return roster.filter(person => (!group || person.cohort === group) && (!query || `${person.full_name} ${person.university_id} ${person.cohort || ''}`.toLocaleLowerCase().includes(query)));
}

function updateRow(id, key, changes) {
  const current = currentRow(id, key);
  edits.set(`${id}:${key}`, { ...current, ...changes, student_id: id, assessment_key: key });
  const state = document.querySelector(`[data-state-for="${id}"]`);
  if (state) state.textContent = 'Unsaved';
  const row = document.querySelector(`[data-row-for="${id}"]`);
  if (row) row.classList.add('edited');
  $('save-visible').textContent = `Save ${edits.size} edited row${edits.size === 1 ? '' : 's'}`;
}

function renderStaffRows() {
  const item = definitions.find(x => x.key === selectedItemKey);
  if (!item) return;
  const rows = $('staff-rows');
  rows.replaceChildren();
  const visible = listVisibleStudents();
  $('staff-count').textContent = `${visible.length} of ${roster.length} students · ${item.label}`;
  for (const person of visible) {
    const grade = currentRow(person.id, item.key);
    const tr = document.createElement('tr');
    tr.dataset.rowFor = person.id;
    if (edits.has(`${person.id}:${item.key}`)) tr.classList.add('edited');
    const name = document.createElement('td');
    appendText(name, 'strong', person.full_name);
    appendText(name, 'small', `${person.university_id} · ${person.cohort || '—'}`);
    tr.append(name);
    const statusCell = document.createElement('td');
    const status = document.createElement('select');
    status.setAttribute('aria-label', `${person.full_name} status for ${item.label}${item.category === 'lab' ? ' (required to release)' : ''}`);
    for (const [value, label] of [['', 'Not graded'], ['pass', 'Pass'], ...(item.category === 'lab' ? [['revise', 'Revise']] : []), ['fail', 'Fail']]) status.add(new Option(label, value));
    status.value = grade.outcome || '';
    status.addEventListener('change', () => updateRow(person.id, item.key, { outcome: status.value || null }));
    statusCell.append(status);tr.append(statusCell);
    const scoreCell = document.createElement('td');
    const score = document.createElement('input');
    score.type = 'number';score.min = '0';score.max = String(item.max_score);score.step = '0.01';score.placeholder = item.category === 'lab' ? 'Optional' : 'Required to release';
    score.setAttribute('aria-label', `${person.full_name} score for ${item.label}${item.category === 'lab' ? ' (optional)' : ' (required to release)'}`);
    score.value = numeric(grade.score) === null ? '' : String(grade.score);
    score.addEventListener('change', () => updateRow(person.id, item.key, { score: score.value.trim() === '' ? null : Number(score.value) }));
    scoreCell.append(score);tr.append(scoreCell);
    const visibility = document.createElement('td');
    const published = document.createElement('input');
    published.type = 'checkbox'; published.checked = Boolean(grade.published);
    published.setAttribute('aria-label', `Release ${item.label} to ${person.full_name}`);
    published.addEventListener('change', () => updateRow(person.id, item.key, { published: published.checked }));
    visibility.append(published);tr.append(visibility);
    const stateCell = document.createElement('td');
    appendText(stateCell, 'span', edits.has(`${person.id}:${item.key}`) ? 'Unsaved' : entryFor(person.id, item.key) ? 'Saved' : '—', 'save-state').dataset.stateFor = person.id;
    tr.append(stateCell);rows.append(tr);
  }
}

async function loadStaff() {
  [definitions, settings, roster, entries] = await Promise.all([
    db.from('assessment_definitions').select('*').order('sort_order').then(check),
    db.from('grading_settings').select('*').eq('id', 1).single().then(check),
    db.from('course_students').select('id,learner_id,university_id,full_name,cohort').order('full_name').then(check),
    fetchAllStaffGrades()
  ]);
  edits.clear();
  $('save-visible').textContent = 'Save edited rows';
  const itemSelect = $('staff-item');
  const previous = selectedItemKey;
  itemSelect.replaceChildren();
  for (const definition of definitions) itemSelect.add(new Option(`${definition.label} · ${definition.category === 'lab' ? 'Lab' : definition.weight + '%'}`, definition.key));
  selectedItemKey = definitions.some(item => item.key === previous) ? previous : definitions[0]?.key || '';
  itemSelect.value = selectedItemKey;
  const groupSelect = $('staff-group');
  const oldGroup = groupSelect.value;
  groupSelect.replaceChildren(new Option('All groups', ''));
  for (const group of [...new Set(roster.map(person => person.cohort).filter(Boolean))].sort()) groupSelect.add(new Option(group, group));
  groupSelect.value = oldGroup;
  $('pass-mark').value = numeric(settings.pass_threshold) === null ? '' : String(settings.pass_threshold);
  $('pass-mark').disabled = role !== 'instructor';
  $('pass-form').querySelector('button').hidden = role !== 'instructor';
  $('pass-updated').textContent = role !== 'instructor' ? 'Only the instructor can change the course pass mark.' : numeric(settings.pass_threshold) === null ? 'No official pass mark has been set yet.' : `Current pass mark: ${format(settings.pass_threshold)} / 100`;
  renderStaffRows();
  showPanel('staff-panel');
}

async function enter() {
  message('');
  const session = check(await db.auth.getSession()).session;
  if (!session) { $('account-label').textContent = ''; showPanel('auth-panel'); return; }
  $('account-label').textContent = session.user.email || '';
  role = check(await db.rpc('my_grade_role'));
  if (role === 'instructor' || role === 'ta') { await loadStaff(); return; }
  const rows = check(await db.from('course_students').select('id,university_id,full_name,cohort').limit(2));
  if (rows.length > 1) throw new Error('Your account is connected to more than one record. Contact the teaching team.');
  if (!rows.length) { showPanel('claim-panel'); return; }
  student = rows[0];
  await loadStudent();
}

$('email-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  await busy(button, async () => {
    try {
      const email = $('email').value.trim();
      check(await db.auth.signInWithOtp({ email, options: { shouldCreateUser: true } }));
      $('code-form').hidden = false;
      message('A one-time code has been sent. Check your inbox and spam folder.', 'success');
      $('email-code').focus();
    } catch (error) { tellError(error); }
  });
});

$('code-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  await busy(button, async () => {
    try {
      check(await db.auth.verifyOtp({ email: $('email').value.trim(), token: $('email-code').value.trim(), type: 'email' }));
      await enter();
    } catch (error) { tellError(error, 'Could not verify the code. Request a new one and try again.'); }
  });
});

$('claim-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  await busy(button, async () => {
    try {
      const claimed = check(await db.rpc('claim_my_student', { invite_code: $('claim-code').value.trim() }));
      if (!claimed) throw new Error('That invitation code is invalid, expired, or already linked to another account. Contact the teaching team.');
      $('claim-code').value = '';
      message('Your student record is connected.', 'success');
      await enter();
    } catch (error) { tellError(error, 'That invitation code could not be used. Contact the teaching team.'); }
  });
});

$('sign-out').addEventListener('click', async () => {
  try {
    check(await db.auth.signOut());
    student = null;role = null;entries = [];roster = [];edits.clear();
    $('code-form').hidden = true;$('email-code').value = '';$('claim-code').value = '';
    message('You have signed out.', 'success');
    await enter();
  } catch (error) { tellError(error); }
});

$('refresh-student').addEventListener('click', async event => {
  await busy(event.currentTarget, async () => { try { await loadStudent();message('Results refreshed.', 'success'); } catch (error) { tellError(error); } });
});
$('refresh-staff').addEventListener('click', async event => {
  if (edits.size && !confirm('Discard unsaved edits and refresh the roster?')) return;
  await busy(event.currentTarget, async () => { try { await loadStaff();message('Roster refreshed.', 'success'); } catch (error) { tellError(error); } });
});
$('staff-item').addEventListener('change', event => { selectedItemKey = event.currentTarget.value;renderStaffRows(); });
$('staff-search').addEventListener('input', renderStaffRows);
$('staff-group').addEventListener('change', renderStaffRows);

$('save-visible').addEventListener('click', async event => {
  if (!edits.size) { message('No edited rows to save.'); return; }
  const itemByKey = new Map(definitions.map(item => [item.key, item]));
  const updates = [];
  const removals = [];
  for (const edit of edits.values()) {
    const item = itemByKey.get(edit.assessment_key);
    const score = numeric(edit.score);
    if (!item || score !== null && (!Number.isFinite(score) || score < 0 || score > Number(item.max_score))) {
      message('Each score must be between 0 and the assessment maximum.', 'error');return;
    }
    if (edit.published && item.category === 'lab' && !VALID_OUTCOMES.has(edit.outcome)) {
      message('Choose Pass, Revise, or Fail for every lab you release.', 'error');return;
    }
    if (edit.published && item.category !== 'lab' && score === null) {
      message('Enter a numeric score before releasing an exam or assignment.', 'error');return;
    }
    if (score === null && !VALID_OUTCOMES.has(edit.outcome)) {
      if (entryFor(edit.student_id, edit.assessment_key)) removals.push(edit);
      continue;
    }
    updates.push({ student_id: edit.student_id, assessment_key: edit.assessment_key, score, outcome: edit.outcome || null, published: Boolean(edit.published), note: edit.note || null });
  }
  await busy(event.currentTarget, async () => {
    try {
      if (updates.length) check(await db.from('grade_entries').upsert(updates, { onConflict: 'student_id,assessment_key' }));
      for (const row of removals) check(await db.from('grade_entries').delete().eq('student_id', row.student_id).eq('assessment_key', row.assessment_key));
      const changedKeys = new Set([...updates, ...removals].map(row => `${row.student_id}:${row.assessment_key}`));
      entries = entries.filter(row => !changedKeys.has(`${row.student_id}:${row.assessment_key}`)).concat(updates);
      edits.clear();$('save-visible').textContent = 'Save edited rows';renderStaffRows();
      message(`${updates.length + removals.length} result${updates.length + removals.length === 1 ? '' : 's'} saved. Released results are now visible to the relevant students.`, 'success');
    } catch (error) { tellError(error, 'A result could not be saved. Refresh the roster before trying again to check which edits were applied.'); }
  });
});

$('pass-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (role !== 'instructor') return;
  const value = Number($('pass-mark').value);
  if (!Number.isFinite(value) || value < 0 || value > 100) { message('Pass mark must be between 0 and 100.', 'error'); return; }
  await busy(event.currentTarget.querySelector('button'), async () => {
    try {
      check(await db.from('grading_settings').update({ pass_threshold: value }).eq('id', 1));
      settings.pass_threshold = value;
      $('pass-updated').textContent = `Current pass mark: ${format(value)} / 100`;
      message('Course pass mark saved.', 'success');
    } catch (error) { tellError(error, 'Pass mark could not be saved.'); }
  });
});

async function start() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) { showPanel('setup-panel'); return; }
  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm');
    db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    await enter();
  } catch (error) {
    tellError(error, 'The grade portal is temporarily unavailable. Please try again later.');
    showPanel('setup-panel');
  }
}

start();
