// ---------- state ----------
const ROSTER = ['Aneya', 'Anish', 'Ashray', 'Ishaan', 'Kevin', 'Alex', 'Andrei'];
const WIPE_PASSWORD = '8Yma4Dw5576t';

let data = { members: ROSTER.slice(), availability: {} };
let currentMember = localStorage.getItem('currentMember') || '';
let view = 'my'; // 'my' | 'team'
const today = new Date();
today.setHours(0, 0, 0, 0);
let viewYear = today.getFullYear();
let viewMonth = today.getMonth();
let selectedDate = null; // 'YYYY-MM-DD'

const MEMBER_COLORS = [
  '#0069ff', '#f4470b', '#00a86b', '#8e44ad', '#e6a700',
  '#e91e63', '#00838f', '#5d4037', '#3f51b5', '#689f38',
];

// 1:00pm – 7:00pm in 1-hour steps
const SLOTS = [];
for (let h = 13; h <= 19; h++) {
  SLOTS.push(`${String(h).padStart(2, '0')}:00`);
}

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);

function fmtSlot(slot) {
  const [h, m] = slot.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}

function dateKey(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function memberColor(name) {
  const i = data.members.indexOf(name);
  return MEMBER_COLORS[(i < 0 ? 0 : i) % MEMBER_COLORS.length];
}

function memberSlots(member, date) {
  const byDate = data.availability[member];
  return (byDate && byDate[date]) || [];
}

function membersOnDate(key) {
  return data.members.filter((m) => memberSlots(m, key).length > 0);
}

let noticeTimer;
function notice(msg) {
  let el = document.querySelector('.notice');
  if (!el) {
    el = document.createElement('div');
    el.className = 'notice';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---------- shared storage (Firebase Realtime Database REST) ----------
function normalize(remote) {
  const avail = {};
  const rawAvail = (remote && remote.availability) || {};
  for (const m of Object.keys(rawAvail)) {
    avail[m] = {};
    for (const d of Object.keys(rawAvail[m] || {})) {
      // Firebase may return arrays as objects with numeric keys
      avail[m][d] = Object.values(rawAvail[m][d] || {});
    }
  }
  return {
    members: (remote && remote.members && Object.values(remote.members)) || ROSTER.slice(),
    availability: avail,
  };
}

async function fetchData() {
  if (!DB_URL) return;
  const res = await fetch(`${DB_URL}/team.json`);
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const remote = await res.json();
  if (remote === null) {
    // first ever load — seed the roster
    await fetch(`${DB_URL}/team/members.json`, {
      method: 'PUT',
      body: JSON.stringify(ROSTER),
    });
    data = { members: ROSTER.slice(), availability: {} };
  } else {
    data = normalize(remote);
  }
}

async function saveAvailability(member, date, slots) {
  if (!DB_URL) {
    notice('Storage not connected — this won’t be saved');
    data.availability[member] = data.availability[member] || {};
    data.availability[member][date] = slots;
    return;
  }
  const url = `${DB_URL}/team/availability/${encodeURIComponent(member)}/${date}.json`;
  const res = slots.length
    ? await fetch(url, { method: 'PUT', body: JSON.stringify(slots.sort()) })
    : await fetch(url, { method: 'DELETE' });
  if (!res.ok) {
    notice('Save failed — check your connection');
    return;
  }
  data.availability[member] = data.availability[member] || {};
  if (slots.length) data.availability[member][date] = slots;
  else delete data.availability[member][date];
}

// ---------- rendering ----------
function renderMemberSelect() {
  const sel = $('member-select');
  sel.innerHTML = '<option value="">Who are you?</option>';
  for (const m of data.members) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    if (m === currentMember) opt.selected = true;
    sel.appendChild(opt);
  }
}

function renderLeftPanel() {
  const legend = $('member-legend');
  if (view === 'team') {
    $('panel-subtitle').textContent = 'Robotics Team';
    $('panel-title').textContent = 'Team Availability';
    $('panel-description').textContent =
      'Every member’s availability in one calendar. Highlighted dates have at least one person free — click one to see who can make each time.';
    legend.classList.remove('hidden');
    legend.innerHTML = '';
    for (const m of data.members) {
      const item = document.createElement('div');
      item.className = 'legend-item';
      const dot = document.createElement('span');
      dot.className = 'legend-dot';
      dot.style.background = memberColor(m);
      const label = document.createElement('span');
      label.textContent = m;
      item.append(dot, label);
      legend.appendChild(item);
    }
  } else {
    $('panel-subtitle').textContent = currentMember ? currentMember : 'Robotics Team';
    $('panel-title').textContent = 'Availability';
    $('panel-description').textContent =
      'Select the dates and times you’re free for team meetings. Click a highlighted time to remove it. Your teammates will see your availability in the Team View.';
    legend.classList.add('hidden');
  }
}

function renderCalendar() {
  $('month-label').textContent = new Date(viewYear, viewMonth).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  // disable going to past months
  $('prev-month').disabled =
    viewYear < today.getFullYear() ||
    (viewYear === today.getFullYear() && viewMonth <= today.getMonth());

  const grid = $('days-grid');
  grid.innerHTML = '';
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  for (let i = 0; i < firstDow; i++) {
    grid.appendChild(document.createElement('span'));
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const btn = document.createElement('button');
    btn.className = 'day';
    btn.textContent = d;
    const key = dateKey(viewYear, viewMonth, d);
    const dateObj = new Date(viewYear, viewMonth, d);

    const isPast = dateObj < today;
    const isToday = dateObj.getTime() === today.getTime();
    if (isToday) btn.classList.add('today');

    let hasAvail = false;
    if (view === 'my') {
      hasAvail = currentMember && memberSlots(currentMember, key).length > 0;
    } else {
      hasAvail = membersOnDate(key).length > 0;
    }

    const selectable = view === 'my' ? !isPast : !isPast || hasAvail;
    if (selectable) {
      btn.classList.add('selectable');
      if (hasAvail) btn.classList.add('has-availability');
      btn.addEventListener('click', () => {
        selectedDate = key;
        render();
      });
    }
    if (selectedDate === key) btn.classList.add('selected');

    grid.appendChild(btn);
  }
}

function renderSlots() {
  const dateLabel = $('slots-date');
  const list = $('slots-list');
  list.innerHTML = '';

  if (!selectedDate) {
    dateLabel.textContent = '';
    list.innerHTML = '<div class="slots-empty">Pick a date to see times</div>';
    return;
  }

  const [y, m, d] = selectedDate.split('-').map(Number);
  dateLabel.textContent = new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  if (view === 'my') {
    if (!currentMember) {
      list.innerHTML =
        '<div class="slots-empty">Pick your name in the top-right to mark your availability.</div>';
      return;
    }
    const mine = memberSlots(currentMember, selectedDate);
    for (const slot of SLOTS) {
      const btn = document.createElement('button');
      btn.className = 'slot-btn' + (mine.includes(slot) ? ' selected' : '');
      btn.textContent = fmtSlot(slot);
      btn.addEventListener('click', () => toggleSlot(slot));
      list.appendChild(btn);
    }
  } else {
    const free = membersOnDate(selectedDate);
    if (free.length === 0) {
      list.innerHTML = '<div class="slots-empty">No one has marked availability for this date yet.</div>';
      return;
    }
    const maxCount = Math.max(
      ...SLOTS.map((s) => free.filter((m) => memberSlots(m, selectedDate).includes(s)).length)
    );
    for (const slot of SLOTS) {
      const names = free.filter((m) => memberSlots(m, selectedDate).includes(slot));
      if (names.length === 0) continue;
      const row = document.createElement('div');
      row.className = 'team-slot' + (names.length === maxCount && maxCount > 1 ? ' popular' : '');
      const time = document.createElement('div');
      time.className = 'team-slot-time';
      time.textContent = `${fmtSlot(slot)} · ${names.length} free`;
      const chips = document.createElement('div');
      chips.className = 'team-slot-members';
      for (const n of names) {
        const chip = document.createElement('span');
        chip.className = 'member-chip';
        chip.style.background = memberColor(n);
        chip.textContent = n;
        chips.appendChild(chip);
      }
      row.append(time, chips);
      list.appendChild(row);
    }
  }
}

function renderHeading() {
  $('right-heading').textContent =
    view === 'my' ? 'Select a Date & Time' : 'Team Availability by Date';
}

function confirmIdentity(name) {
  currentMember = name;
  localStorage.setItem('currentMember', name);
  sessionStorage.setItem('identityConfirmed', '1');
  render();
}

function renderWelcome() {
  const overlay = $('welcome-overlay');
  // ask on every new visit (once per tab session), not just the first ever
  if (currentMember && sessionStorage.getItem('identityConfirmed')) {
    overlay.classList.add('hidden');
    return;
  }
  overlay.classList.remove('hidden');
  const grid = $('welcome-names');
  grid.innerHTML = '';
  for (const m of data.members) {
    const btn = document.createElement('button');
    btn.className = 'name-btn' + (m === currentMember ? ' current' : '');
    btn.textContent = m === currentMember ? `${m} (you last time)` : m;
    btn.addEventListener('click', () => confirmIdentity(m));
    grid.appendChild(btn);
  }
}

function renderBanner() {
  $('config-banner').classList.toggle('hidden', Boolean(DB_URL));
}

function render() {
  renderMemberSelect();
  renderLeftPanel();
  renderHeading();
  renderCalendar();
  renderSlots();
  renderWelcome();
  renderBanner();
}

// ---------- actions ----------
async function toggleSlot(slot) {
  if (!currentMember) return notice('Pick your name first (top right)');
  const mine = memberSlots(currentMember, selectedDate).slice();
  const i = mine.indexOf(slot);
  if (i >= 0) mine.splice(i, 1);
  else mine.push(slot);
  await saveAvailability(currentMember, selectedDate, mine);
  render();
}

async function onWipe() {
  const password = prompt('Enter the admin password to wipe ALL availability data:');
  if (password === null) return;
  if (password !== WIPE_PASSWORD) return notice('Wrong password — nothing was wiped');
  if (DB_URL) {
    const res = await fetch(`${DB_URL}/team/availability.json`, { method: 'DELETE' });
    if (!res.ok) return notice('Wipe failed — check your connection');
  }
  data.availability = {};
  selectedDate = null;
  notice('All availability data wiped');
  render();
}

// ---------- wiring ----------
$('prev-month').addEventListener('click', () => {
  viewMonth--;
  if (viewMonth < 0) { viewMonth = 11; viewYear--; }
  render();
});
$('next-month').addEventListener('click', () => {
  viewMonth++;
  if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  render();
});
$('tab-my').addEventListener('click', () => { view = 'my'; $('tab-my').classList.add('active'); $('tab-team').classList.remove('active'); render(); });
$('tab-team').addEventListener('click', () => { view = 'team'; $('tab-team').classList.add('active'); $('tab-my').classList.remove('active'); render(); });
$('wipe-btn').addEventListener('click', onWipe);
$('member-select').addEventListener('change', (e) => {
  if (e.target.value) {
    confirmIdentity(e.target.value);
  } else {
    currentMember = '';
    localStorage.removeItem('currentMember');
    sessionStorage.removeItem('identityConfirmed');
    render();
  }
});

$('tz-name').textContent =
  Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, ' ') +
  ' (' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase() + ')';

// refresh shared data periodically so teammates' edits show up
setInterval(async () => {
  try {
    await fetchData();
    render();
  } catch { /* offline blip — try again next tick */ }
}, 10000);

(async function init() {
  try {
    await fetchData();
  } catch {
    notice('Couldn’t reach storage — retrying…');
  }
  if (currentMember && !data.members.includes(currentMember)) currentMember = '';
  selectedDate = dateKey(today.getFullYear(), today.getMonth(), today.getDate());
  render();
})();
