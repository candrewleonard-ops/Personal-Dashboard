/* =============================================================
 * Reinnovation Homes Dashboard - Renderer
 * Tasks / Calendar / Pomodoro / Habits
 * ============================================================= */

const api = window.api;

/* ------------------- STATE ------------------- */
const state = {
  tasks: {},                 // { 'YYYY-MM-DD': [ {id, text, done, priority} ] }
  habits: {
    habits: [],              // { id, name, streak, lastChecked, history: [] }
    pomodoro: { sessionsToday: 0, lastDate: null, totalMinutes: 0 }
  },
  currentDate: new Date(),   // currently-viewed day
  activeTab: 'dashboard',
  timer: {
    minutes: 25,
    secondsLeft: 25 * 60,
    running: false,
    intervalId: null,
    targetMinutes: 25
  },
  openMenuTaskId: null
};

/* ------------------- UTILS ------------------- */
const pad = n => String(n).padStart(2, '0');

function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayKey() { return dateKey(new Date()); }

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
}

function prettyDate(d) {
  return d.toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });
}

function prettyTime(d) {
  return d.toLocaleTimeString(undefined, {
    hour: 'numeric', minute: '2-digit', second: '2-digit'
  });
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function greetingFor(d) {
  const h = d.getHours();
  if (h < 5)  return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 21) return 'Good evening';
  return 'Good night';
}

function fmtMoney(n) {
  return '$' + Math.round(n).toLocaleString();
}

/* ------------------- STORAGE ------------------- */
async function loadAll() {
  state.tasks  = (await api.store.get('tasks'))  || {};
  state.habits = (await api.store.get('habits')) || { habits: [], pomodoro: { sessionsToday: 0, lastDate: null, totalMinutes: 0 } };

  // Reset pomodoro counter at date change
  const t = todayKey();
  if (state.habits.pomodoro.lastDate !== t) {
    state.habits.pomodoro.sessionsToday = 0;
    state.habits.pomodoro.totalMinutes = 0;
    state.habits.pomodoro.lastDate = t;
    await saveHabits();
  }
}

async function saveTasks()  { await api.store.set('tasks',  state.tasks); }
async function saveHabits() { await api.store.set('habits', state.habits); }

/* ------------------- TABS ------------------- */
function initTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      state.activeTab = target;
      document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === btn));
      document.querySelectorAll('.page').forEach(p => {
        p.classList.toggle('active', p.id === `page-${target}`);
      });
    });
  });
}

/* ------------------- CLOCK / HEADER ------------------- */
function tickClock() {
  const now = new Date();
  document.getElementById('sidebar-clock').textContent = prettyTime(now);
  document.getElementById('sidebar-date').textContent = now.toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric'
  });

  // Headline time only refreshes when viewing today
  if (sameDay(state.currentDate, now)) {
    document.getElementById('headline-time').textContent = prettyTime(now);
  }
}

function renderHeader() {
  const d = state.currentDate;
  const now = new Date();
  const isToday = sameDay(d, now);

  document.getElementById('greeting').textContent =
    isToday ? greetingFor(now)
            : d > now ? 'Planning ahead' : 'Looking back';

  document.getElementById('headline-date').textContent = prettyDate(d);
  document.getElementById('headline-time').textContent =
    isToday ? prettyTime(now) : (d > now ? 'Upcoming day' : 'Past day');
}

/* ------------------- DAY NAVIGATION ------------------- */
function initDayNav() {
  document.getElementById('day-prev').addEventListener('click', () => shiftDay(-1));
  document.getElementById('day-next').addEventListener('click', () => shiftDay(+1));
  document.getElementById('day-today').addEventListener('click', () => {
    state.currentDate = new Date();
    renderHeader();
    renderTasks();
    renderStats();
  });

  document.addEventListener('keydown', (e) => {
    if (state.activeTab !== 'dashboard') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft')  shiftDay(-1);
    if (e.key === 'ArrowRight') shiftDay(+1);
    if (e.key === 't' || e.key === 'T') {
      state.currentDate = new Date();
      renderHeader(); renderTasks(); renderStats();
    }
  });
}

function shiftDay(delta) {
  const d = new Date(state.currentDate);
  d.setDate(d.getDate() + delta);
  state.currentDate = d;
  renderHeader();
  renderTasks();
  renderStats();
}

/* ------------------- TASKS ------------------- */
function getDayTasks() {
  const key = dateKey(state.currentDate);
  if (!state.tasks[key]) state.tasks[key] = [];
  return state.tasks[key];
}

function renderTasks() {
  const list = document.getElementById('task-list');
  const empty = document.getElementById('task-empty');
  const counter = document.getElementById('task-counter');
  const tasks = getDayTasks();

  list.innerHTML = '';

  if (tasks.length === 0) {
    empty.style.display = 'block';
  } else {
    empty.style.display = 'none';
  }

  const done = tasks.filter(t => t.done).length;
  counter.textContent = `${done} / ${tasks.length}`;

  tasks.forEach(task => {
    const li = document.createElement('li');
    li.className = 'task-item' + (task.done ? ' done' : '');

    // Checkbox
    const cb = document.createElement('button');
    cb.className = 'task-checkbox';
    cb.title = 'Toggle done';
    cb.addEventListener('click', async () => {
      task.done = !task.done;
      await saveTasks();
      renderTasks();
      renderStats();
    });
    li.appendChild(cb);

    // Text
    const text = document.createElement('div');
    text.className = 'task-text';
    text.textContent = task.text;
    li.appendChild(text);

    // Priority pill
    if (task.priority && task.priority !== 'none') {
      const p = document.createElement('span');
      p.className = `task-priority ${task.priority}`;
      p.textContent = task.priority === 'high' ? 'High'
                     : task.priority === 'med'  ? 'Med' : 'Low';
      li.appendChild(p);
    }

    // Triple-dot menu
    const menuBtn = document.createElement('button');
    menuBtn.className = 'task-menu-btn';
    menuBtn.innerHTML = '&#8943;'; // ⋯
    menuBtn.title = 'More';
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleTaskMenu(li, task);
    });
    li.appendChild(menuBtn);

    list.appendChild(li);
  });
}

function toggleTaskMenu(li, task) {
  // Close any existing menu
  document.querySelectorAll('.task-menu').forEach(m => m.remove());
  if (state.openMenuTaskId === task.id) { state.openMenuTaskId = null; return; }
  state.openMenuTaskId = task.id;

  const menu = document.createElement('div');
  menu.className = 'task-menu';

  const editBtn = document.createElement('button');
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', () => { menu.remove(); state.openMenuTaskId = null; openTaskModal(task); });
  menu.appendChild(editBtn);

  const dupBtn = document.createElement('button');
  dupBtn.textContent = 'Duplicate';
  dupBtn.addEventListener('click', async () => {
    menu.remove(); state.openMenuTaskId = null;
    const tasks = getDayTasks();
    tasks.push({ ...task, id: uid(), done: false });
    await saveTasks();
    renderTasks();
    renderStats();
  });
  menu.appendChild(dupBtn);

  const delBtn = document.createElement('button');
  delBtn.className = 'danger';
  delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', async () => {
    menu.remove(); state.openMenuTaskId = null;
    const tasks = getDayTasks();
    const i = tasks.findIndex(t => t.id === task.id);
    if (i >= 0) tasks.splice(i, 1);
    await saveTasks();
    renderTasks();
    renderStats();
  });
  menu.appendChild(delBtn);

  li.appendChild(menu);
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.task-menu') && !e.target.closest('.task-menu-btn')) {
    document.querySelectorAll('.task-menu').forEach(m => m.remove());
    state.openMenuTaskId = null;
  }
});

/* ------------------- STATS ------------------- */
function renderStats() {
  const tasks = getDayTasks();
  const done = tasks.filter(t => t.done).length;
  const open = tasks.length - done;
  document.getElementById('stat-done').textContent = done;
  document.getElementById('stat-open').textContent = open;

  const streaks = state.habits.habits.reduce((acc, h) => acc + (h.streak || 0), 0);
  document.getElementById('stat-streaks').textContent = streaks;
  document.getElementById('stat-focus').textContent = state.habits.pomodoro.totalMinutes || 0;

  const pct = tasks.length === 0 ? 0 : Math.round((done / tasks.length) * 100);
  document.getElementById('progress-pct').textContent = `${pct}%`;
  document.getElementById('progress-fill').style.width = `${pct}%`;
}

/* ------------------- MODAL ------------------- */
const modalEl       = document.getElementById('modal');
const modalBackdrop = document.getElementById('modal-backdrop');
const modalTitle    = document.getElementById('modal-title');
const modalBody     = document.getElementById('modal-body');
const modalSave     = document.getElementById('modal-save');
const modalCancel   = document.getElementById('modal-cancel');
const modalClose    = document.getElementById('modal-close');

let modalOnSave = null;

function openModal(title, bodyHtml, onSave) {
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHtml;
  modalOnSave = onSave;
  modalBackdrop.classList.remove('hidden');
  const first = modalBody.querySelector('input, textarea, select');
  if (first) setTimeout(() => first.focus(), 40);
}

function closeModal() {
  modalBackdrop.classList.add('hidden');
  modalOnSave = null;
}

modalCancel.addEventListener('click', closeModal);
modalClose.addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', (e) => { if (e.target === modalBackdrop) closeModal(); });
modalSave.addEventListener('click', () => { if (modalOnSave) modalOnSave(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
  if (e.key === 'Enter' && !modalBackdrop.classList.contains('hidden')
      && e.target.tagName !== 'TEXTAREA' && modalOnSave) {
    modalOnSave();
  }
});

function openTaskModal(existing) {
  const isEdit = !!existing;
  openModal(isEdit ? 'Edit Task' : 'Add Task', `
    <div>
      <label>Task</label>
      <input type="text" id="task-input" placeholder="What needs to get done?"
             value="${existing ? escapeAttr(existing.text) : ''}" maxlength="200" />
    </div>
    <div>
      <label>Priority</label>
      <select id="task-priority">
        <option value="none" ${!existing || existing.priority === 'none' ? 'selected' : ''}>None</option>
        <option value="low"  ${existing && existing.priority === 'low'  ? 'selected' : ''}>Low</option>
        <option value="med"  ${existing && existing.priority === 'med'  ? 'selected' : ''}>Medium</option>
        <option value="high" ${existing && existing.priority === 'high' ? 'selected' : ''}>High</option>
      </select>
    </div>
  `, async () => {
    const text = document.getElementById('task-input').value.trim();
    const priority = document.getElementById('task-priority').value;
    if (!text) return;
    const tasks = getDayTasks();
    if (isEdit) {
      existing.text = text;
      existing.priority = priority;
    } else {
      tasks.push({ id: uid(), text, done: false, priority, createdAt: Date.now() });
    }
    await saveTasks();
    closeModal();
    renderTasks();
    renderStats();
  });
}

function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

/* ------------------- POMODORO ------------------- */
function renderTimer() {
  const mins = Math.floor(state.timer.secondsLeft / 60);
  const secs = state.timer.secondsLeft % 60;
  document.getElementById('timer-display').textContent = `${pad(mins)}:${pad(secs)}`;
}

function setTimerMinutes(m) {
  stopTimer();
  state.timer.targetMinutes = m;
  state.timer.secondsLeft = m * 60;
  renderTimer();
}

function startTimer() {
  if (state.timer.running) return;
  state.timer.running = true;
  state.timer.intervalId = setInterval(async () => {
    state.timer.secondsLeft -= 1;
    if (state.timer.secondsLeft <= 0) {
      stopTimer();
      await onSessionComplete();
      return;
    }
    renderTimer();
  }, 1000);
}

function stopTimer() {
  state.timer.running = false;
  if (state.timer.intervalId) {
    clearInterval(state.timer.intervalId);
    state.timer.intervalId = null;
  }
}

function resetTimer() {
  stopTimer();
  state.timer.secondsLeft = state.timer.targetMinutes * 60;
  renderTimer();
}

async function onSessionComplete() {
  // Only count sessions of at least 20 minutes as a full focus session
  if (state.timer.targetMinutes >= 20) {
    state.habits.pomodoro.sessionsToday = (state.habits.pomodoro.sessionsToday || 0) + 1;
  }
  state.habits.pomodoro.totalMinutes = (state.habits.pomodoro.totalMinutes || 0) + state.timer.targetMinutes;
  await saveHabits();
  renderPomodoroStats();
  renderStats();
  state.timer.secondsLeft = state.timer.targetMinutes * 60;
  renderTimer();
  try { flashTimerDone(); } catch (e) {}
}

function flashTimerDone() {
  const el = document.getElementById('timer-display');
  el.animate([
    { textShadow: '0 0 40px rgba(77,163,255,.25)' },
    { textShadow: '0 0 70px rgba(46,213,115,.75)' },
    { textShadow: '0 0 40px rgba(77,163,255,.25)' }
  ], { duration: 900, iterations: 2 });
}

function renderPomodoroStats() {
  document.getElementById('pomo-sessions').textContent = state.habits.pomodoro.sessionsToday || 0;
  document.getElementById('pomo-minutes').textContent = state.habits.pomodoro.totalMinutes || 0;
}

function initPomodoro() {
  document.getElementById('timer-start').addEventListener('click', startTimer);
  document.getElementById('timer-pause').addEventListener('click', stopTimer);
  document.getElementById('timer-reset').addEventListener('click', resetTimer);
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b === btn));
      setTimerMinutes(parseInt(btn.dataset.minutes, 10));
    });
  });
  renderTimer();
  renderPomodoroStats();
}

/* ------------------- HABITS ------------------- */
function renderHabits() {
  const list = document.getElementById('habit-list');
  const empty = document.getElementById('habit-empty');
  list.innerHTML = '';

  if (state.habits.habits.length === 0) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  const today = todayKey();

  state.habits.habits.forEach(habit => {
    const li = document.createElement('li');
    li.className = 'habit-item';

    const checkedToday = habit.lastChecked === today;

    const check = document.createElement('button');
    check.className = 'habit-check' + (checkedToday ? ' checked' : '');
    check.title = checkedToday ? 'Checked in' : 'Mark done today';
    check.addEventListener('click', async () => {
      await toggleHabit(habit);
    });
    li.appendChild(check);

    const info = document.createElement('div');
    info.className = 'habit-info';
    const name = document.createElement('div');
    name.className = 'habit-name';
    name.textContent = habit.name;
    info.appendChild(name);
    const sub = document.createElement('div');
    sub.className = 'habit-sub';
    sub.textContent = checkedToday ? 'Done today — keep it rolling' : 'Tap the circle to check in';
    info.appendChild(sub);
    li.appendChild(info);

    const badge = document.createElement('div');
    badge.className = 'streak-badge';
    badge.textContent = `${habit.streak || 0}`;
    li.appendChild(badge);

    const del = document.createElement('button');
    del.className = 'habit-delete';
    del.title = 'Delete habit';
    del.innerHTML = '&times;';
    del.addEventListener('click', async () => {
      if (!confirm(`Delete habit "${habit.name}"?`)) return;
      state.habits.habits = state.habits.habits.filter(h => h.id !== habit.id);
      await saveHabits();
      renderHabits();
      renderStats();
    });
    li.appendChild(del);

    list.appendChild(li);
  });
}

async function toggleHabit(habit) {
  const today = todayKey();
  if (habit.lastChecked === today) {
    // Un-check today
    habit.streak = Math.max(0, (habit.streak || 1) - 1);
    habit.lastChecked = null;
  } else {
    // Check in: if last was yesterday, increment; else reset to 1
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const yKey = dateKey(yesterday);
    if (habit.lastChecked === yKey) habit.streak = (habit.streak || 0) + 1;
    else habit.streak = 1;
    habit.lastChecked = today;
  }
  await saveHabits();
  renderHabits();
  renderStats();
}

function openHabitModal() {
  openModal('New Habit', `
    <div>
      <label>Habit name</label>
      <input type="text" id="habit-input" placeholder="e.g. Underwrite 3 deals" maxlength="60" />
    </div>
  `, async () => {
    const name = document.getElementById('habit-input').value.trim();
    if (!name) return;
    state.habits.habits.push({
      id: uid(),
      name,
      streak: 0,
      lastChecked: null,
      createdAt: Date.now()
    });
    await saveHabits();
    closeModal();
    renderHabits();
    renderStats();
  });
}

/* Auto-break streaks when a day is skipped */
function reconcileHabitStreaks() {
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const tKey = dateKey(today);
  const yKey = dateKey(yesterday);
  state.habits.habits.forEach(h => {
    if (h.lastChecked && h.lastChecked !== tKey && h.lastChecked !== yKey) {
      h.streak = 0;
    }
  });
}

/* ------------------- INIT ------------------- */
async function init() {
  await loadAll();
  reconcileHabitStreaks();
  await saveHabits();

  initTabs();
  initDayNav();
  initPomodoro();

  document.getElementById('add-task-btn').addEventListener('click', () => openTaskModal(null));
  document.getElementById('add-habit-btn').addEventListener('click', openHabitModal);

  renderHeader();
  renderTasks();
  renderStats();
  renderHabits();

  tickClock();
  setInterval(tickClock, 1000);

  // Auto-refresh header/greeting at midnight flip
  setInterval(() => {
    const now = new Date();
    if (sameDay(state.currentDate, now)) {
      renderHeader();
    }
  }, 30000);
}

init().catch(err => {
  console.error('Init failed', err);
  alert('Dashboard failed to start: ' + err.message);
});
