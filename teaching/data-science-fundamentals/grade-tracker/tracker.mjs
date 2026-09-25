// Student-entered planning data only. No roster or university grade record is bundled here.
export const COMPONENTS = [
  { key: 'midterm', name: 'Midterm exam', due: 'Week 6', weight: 20 },
  { key: 'final', name: 'Final exam', due: 'Exam period', weight: 25 },
  { key: 'quality', name: 'Data Quality Report', due: 'Week 4', weight: 10 },
  { key: 'eda', name: 'EDA and Visualization Brief', due: 'Week 7', weight: 10 },
  { key: 'modelling', name: 'Modelling Assignment', due: 'Week 11', weight: 10 },
  { key: 'capstone', name: 'Capstone project and dashboard', due: 'Week 12', weight: 10 }
];

const STORAGE_PREFIX = 'fds-personal-tracker-v1:';
const VALID_LABS = new Set(['pending', 'pass', 'expected', 'revise', 'fail']);

function validScore(value) {
  return value !== null && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100;
}

export function calculateGrade(state) {
  const labs = Array.isArray(state?.labs) ? state.labs.slice(0, 12) : [];
  const passes = labs.filter(status => status === 'pass').length;
  const expected = labs.filter(status => status === 'expected').length;
  const receivedLabPoints = 15 * Math.min(passes, 9) / 9;
  const projectedLabPoints = 15 * Math.min(passes + expected, 9) / 9;
  let received = receivedLabPoints;
  let projected = projectedLabPoints;
  for (const { key, weight } of COMPONENTS) {
    const item = state?.components?.[key];
    if (!item || !validScore(item.score)) continue;
    const points = Number(item.score) * weight / 100;
    projected += points;
    if (item.kind === 'received') received += points;
  }
  const target = Number.isFinite(Number(state?.target)) ? Math.max(0, Math.min(100, Number(state.target))) : 60;
  return { received, projected, target, gap: Math.max(0, target - projected), passes, expected, receivedLabPoints, projectedLabPoints };
}

function emptyState(id, name, group) {
  return { id, name, group, target: 60, labs: Array(12).fill('pending'), components: {} };
}

function normaliseState(raw, id, name, group) {
  const state = emptyState(id, name, group);
  if (!raw || typeof raw !== 'object') return state;
  state.target = raw.target !== null && raw.target !== '' && Number.isInteger(Number(raw.target)) ? Math.max(0, Math.min(100, Number(raw.target))) : 60;
  state.labs = Array.from({ length: 12 }, (_, i) => VALID_LABS.has(raw.labs?.[i]) ? raw.labs[i] : 'pending');
  for (const { key } of COMPONENTS) {
    const item = raw.components?.[key];
    if (item && validScore(item.score)) state.components[key] = { score: Number(item.score), kind: item.kind === 'estimate' ? 'estimate' : 'received' };
  }
  return state;
}

if (typeof document !== 'undefined') {
  const byId = id => document.getElementById(id);
  const profileForm = byId('profile-form');
  const profilePanel = byId('profile-panel');
  const tracker = byId('tracker');
  const labGrid = byId('lab-grid');
  const assessments = byId('assessments');
  let state = null;
  let storageAvailable = true;

  function save() {
    try { localStorage.setItem(STORAGE_PREFIX + state.id, JSON.stringify(state)); }
    catch (_) {
      storageAvailable = false;
      byId('result-text').textContent = 'Browser storage is unavailable. Your changes will last only until this page closes.';
    }
  }

  function load(id, name, group) {
    try { return normaliseState(JSON.parse(localStorage.getItem(STORAGE_PREFIX + id)), id, name, group); }
    catch (_) { storageAvailable = false; return emptyState(id, name, group); }
  }

  function renderLabs() {
    labGrid.replaceChildren();
    const received = state.labs.map((status, i) => status === 'pass' ? i : -1).filter(i => i >= 0);
    const planned = state.labs.map((status, i) => status === 'expected' ? i : -1).filter(i => i >= 0);
    const counted = new Set([...received.slice(0, 9), ...planned.slice(0, Math.max(0, 9 - received.length))]);
    state.labs.forEach((status, i) => {
      const card = document.createElement('div');
      card.className = 'lab ' + (status === 'pending' ? '' : status);
      const head = document.createElement('div');
      head.className = 'lab-head';
      const title = document.createElement('span');
      title.textContent = `Week ${i + 1}`;
      const badge = document.createElement('span');
      badge.textContent = counted.has(i) ? 'Counts in best 9' : (status === 'pass' || status === 'expected' ? 'Extra' : '—');
      head.append(title, badge);
      const meter = document.createElement('div');
      meter.className = 'lab-meter';
      const fill = document.createElement('span');
      meter.append(fill);
      const label = document.createElement('label');
      label.className = 'sr-only';
      label.htmlFor = `lab-${i + 1}`;
      label.textContent = `Week ${i + 1} notebook status`;
      const select = document.createElement('select');
      select.className = 'lab-select';
      select.id = `lab-${i + 1}`;
      for (const [value, text] of [['pending', 'Not graded'], ['pass', 'Pass'], ['revise', 'Revise'], ['fail', 'Fail'], ['expected', 'Expected pass']]) {
        const option = new Option(text, value);
        select.add(option);
      }
      select.value = status;
      select.addEventListener('change', () => { state.labs[i] = select.value; save(); render(); });
      card.append(head, meter, label, select);
      labGrid.append(card);
    });
  }

  function renderAssessments() {
    assessments.replaceChildren();
    for (const { key, name, due, weight } of COMPONENTS) {
      const row = document.createElement('div');
      row.className = 'assessment';
      const details = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = name;
      const note = document.createElement('small');
      note.textContent = `${due} · ${weight}% of course`;
      details.append(title, note);
      const label = document.createElement('label');
      label.className = 'sr-only';
      label.htmlFor = `score-${key}`;
      label.textContent = `${name} score out of 100`;
      const input = document.createElement('input');
      input.id = `score-${key}`;
      input.className = 'grade-input';
      input.type = 'number';
      input.min = '0'; input.max = '100'; input.step = '0.1';
      input.placeholder = '0–100';
      input.value = state.components[key]?.score ?? '';
      const kind = document.createElement('select');
      kind.className = 'kind-select';
      kind.setAttribute('aria-label', `${name} result or estimate`);
      kind.add(new Option('Received', 'received'));
      kind.add(new Option('Estimate', 'estimate'));
      kind.value = state.components[key]?.kind || 'received';
      function update() {
        const score = input.value.trim();
        if (score !== '' && !validScore(score)) return;
        if (score === '') delete state.components[key];
        else state.components[key] = { score: Number(score), kind: kind.value };
        save(); renderSummary();
      }
      input.addEventListener('input', update);
      input.addEventListener('change', () => {
        if (input.value !== '' && !validScore(input.value)) input.value = String(Math.max(0, Math.min(100, Number(input.value) || 0)));
        update();
      });
      kind.addEventListener('change', update);
      row.append(details, label, input, kind);
      assessments.append(row);
    }
  }

  function renderSummary() {
    const result = calculateGrade(state);
    byId('earned-total').textContent = result.received.toFixed(1);
    byId('planned-total').textContent = result.projected.toFixed(1);
    byId('gap-total').textContent = result.gap.toFixed(1);
    byId('earned-bar').style.width = `${result.received}%`;
    byId('plan-bar').style.width = `${result.projected}%`;
    byId('target-marker').style.left = `${result.target}%`;
    byId('target-caption').textContent = `Target ${result.target}`;
    byId('progress-graphic').setAttribute('aria-label', `Received ${result.received.toFixed(1)} points, with estimates ${result.projected.toFixed(1)} points, planning target ${result.target} out of 100`);
    byId('lab-summary').textContent = `${result.passes} received pass${result.passes === 1 ? '' : 'es'} + ${result.expected} expected · ${result.receivedLabPoints.toFixed(1)} of 15 lab points entered · ${result.projectedLabPoints.toFixed(1)} with estimates`;
    const message = byId('result-text');
    message.className = 'result ' + (result.gap <= 0 ? 'good' : 'short');
    message.textContent = result.gap <= 0 ? 'Your scenario reaches the planning pass line.' : `Your scenario needs ${result.gap.toFixed(1)} more course points to reach the planning pass line.`;
    if (!storageAvailable) message.textContent += ' Browser storage is unavailable, so changes may not persist.';
  }

  function render() { renderLabs(); renderSummary(); }

  profileForm.addEventListener('submit', event => {
    event.preventDefault();
    if (!profileForm.reportValidity()) return;
    const id = byId('student-id').value.trim();
    const name = byId('student-name').value.trim();
    const group = byId('student-group').value;
    if (!/^[0-9]{6}$/.test(id) || !name) return;
    state = load(id, name, group);
    state.name = name;
    state.group = group;
    byId('profile-heading').textContent = name;
    byId('profile-details').textContent = `${group} · University ID ${id}`;
    byId('pass-target').value = state.target;
    profilePanel.hidden = true;
    tracker.hidden = false;
    renderAssessments();
    render();
    save();
    byId('profile-heading').scrollIntoView({ block: 'start' });
  });

  byId('pass-target').addEventListener('input', event => {
    if (!state || !event.target.validity.valid || event.target.value === '') return;
    state.target = Number(event.target.value);
    save(); renderSummary();
  });

  byId('switch-profile').addEventListener('click', () => {
    state = null;
    tracker.hidden = true;
    profilePanel.hidden = false;
    profileForm.reset();
    byId('student-id').focus();
  });

  byId('clear-profile').addEventListener('click', () => {
    if (!state || !confirm('Remove this personal tracker from this browser? This cannot be undone.')) return;
    try { localStorage.removeItem(STORAGE_PREFIX + state.id); } catch (_) { /* storage unavailable */ }
    state = null;
    tracker.hidden = true;
    profilePanel.hidden = false;
    profileForm.reset();
    byId('student-id').focus();
  });
}
