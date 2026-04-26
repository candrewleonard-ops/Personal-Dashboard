/* =============================================================
 * Reinnovation Homes Dashboard - Renderer
 * Tasks / Calendar / Pomodoro / Habits
 * ============================================================= */

/* The preload script exposes the storage bridge as window.api. We alias it
 * to `bridge` locally — using `api` here would collide with the script-level
 * binding contextBridge.exposeInMainWorld() creates in contextIsolation mode
 * and throw "Identifier 'api' has already been declared" before any code runs. */
const bridge = window.api;

/* ------------------- STATE ------------------- */
const state = {
  tasks: {},                 // { 'YYYY-MM-DD': [ {id, text, done, priority} ] }
  habits: {
    habits: [],              // { id, name, streak, lastChecked, history: [] }
    pomodoro: { sessionsToday: 0, lastDate: null, totalMinutes: 0 }
  },
  /* Expense schema per day key:
   * { 'YYYY-MM-DD': [ { id, label, notes, amount, category, paid, recurring, recurringGroupId, createdAt } ] }
   * Categories: 'investor_debt' | 'monthly' | 'software' | 'misc'
   * To bulk-add from a contract screenshot, create entries like:
   *   { label:'Investor - Smith', notes:'10% interest, 12mo term', amount:5000,
   *     category:'investor_debt', paid:false, recurring:true }
   * and place them under the correct 'YYYY-MM-DD' key. */
  expenses: {},
  income: {},
  cashflow: { pools: { personal: 0, business: 0, flip_payments: 0, renovation: 0 } },
  calendarFilters: { personal: true, business: true, flip_payments: true, renovation: true },
  notes: {},
  deals: [],
  investors: [],
  currentDate: new Date(),   // currently-viewed day on Dashboard
  calendarMonth: new Date(), // anchors the month shown on Calendar
  selectedDate: new Date(),  // day highlighted in the Calendar side panel
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
  state.tasks    = (await bridge.store.get('tasks'))    || {};
  state.habits   = (await bridge.store.get('habits'))   || { habits: [], pomodoro: { sessionsToday: 0, lastDate: null, totalMinutes: 0 } };
  state.expenses  = (await bridge.store.get('expenses'))  || {};
  state.income    = (await bridge.store.get('income'))    || {};
  state.cashflow  = (await bridge.store.get('cashflow'))  || { pools: { personal: 0, business: 0, flip_payments: 0, renovation: 0 } };
  if (!state.cashflow.pools) state.cashflow.pools = { personal: 0, business: 0, flip_payments: 0, renovation: 0 };
  state.notes     = (await bridge.store.get('notes'))     || {};
  state.deals     = (await bridge.store.get('deals'))     || [];
  state.investors = (await bridge.store.get('investors')) || [];

  // Reset pomodoro counter at date change
  const t = todayKey();
  if (state.habits.pomodoro.lastDate !== t) {
    state.habits.pomodoro.sessionsToday = 0;
    state.habits.pomodoro.totalMinutes = 0;
    state.habits.pomodoro.lastDate = t;
    await saveHabits();
  }
}

async function saveTasks()    { await bridge.store.set('tasks',    state.tasks); }
async function saveHabits()   { await bridge.store.set('habits',   state.habits); }
async function saveExpenses()  { await bridge.store.set('expenses',  state.expenses); }
async function saveCashflow()  { await bridge.store.set('cashflow',  state.cashflow); }
async function saveIncome()    { await bridge.store.set('income',    state.income); }
async function saveNotes()     { await bridge.store.set('notes',     state.notes); }
async function saveDeals()     { await bridge.store.set('deals',     state.deals); }
async function saveInvestors() { await bridge.store.set('investors', state.investors); }

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
      if (target === 'dashboard') {
        renderHeader();
        renderTasks();
        renderStats();
        renderDeadlines();
      } else if (target === 'calendar') {
        renderCalendar();
      } else if (target === 'deals') {
        renderDeals();
      } else if (target === 'investors') {
        renderInvestors();
      } else if (target === 'focus') {
        renderHabits();
      }
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
    renderHabits();
  });

  document.addEventListener('keydown', (e) => {
    if (state.activeTab !== 'dashboard' && state.activeTab !== 'focus') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft')  shiftDay(-1);
    if (e.key === 'ArrowRight') shiftDay(+1);
    if (e.key === 't' || e.key === 'T') {
      state.currentDate = new Date();
      renderHeader(); renderTasks(); renderStats(); renderHabits();
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
  renderHabits();
}

/* ------------------- TASKS ------------------- */
function getDayTasks(date) {
  const d = date || state.currentDate;
  const key = dateKey(d);
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

/* ------------------- CALENDAR ------------------- */
function initCalendar() {
  document.getElementById('cal-prev').addEventListener('click', () => shiftMonth(-1));
  document.getElementById('cal-next').addEventListener('click', () => shiftMonth(+1));
  document.getElementById('cal-today').addEventListener('click', () => {
    state.calendarMonth = new Date();
    state.selectedDate = new Date();
    renderCalendar();
  });
  document.getElementById('add-day-task-btn').addEventListener('click', () => {
    openTaskModalFor(null, state.selectedDate, afterCalendarTaskChange);
  });
  document.getElementById('add-expense-btn').addEventListener('click', () => {
    openExpenseModal(null, state.selectedDate);
  });
  document.getElementById('add-income-btn').addEventListener('click', () => {
    openIncomeModal(state.selectedDate);
  });
  document.querySelectorAll('.pool-bal').forEach(el => {
    el.addEventListener('click', () => openSetPoolBalanceModal(el.dataset.pool));
  });
  document.querySelectorAll('#cal-filters input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      state.calendarFilters[cb.dataset.pool] = cb.checked;
      renderCalendar();
    });
  });

  document.addEventListener('keydown', (e) => {
    if (state.activeTab !== 'calendar') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft')  shiftMonth(-1);
    if (e.key === 'ArrowRight') shiftMonth(+1);
    if (e.key === 't' || e.key === 'T') {
      state.calendarMonth = new Date();
      state.selectedDate = new Date();
      renderCalendar();
    }
  });
}

function shiftMonth(delta) {
  const d = new Date(state.calendarMonth);
  d.setDate(1);
  d.setMonth(d.getMonth() + delta);
  state.calendarMonth = d;
  renderCalendar();
}

function afterCalendarTaskChange() {
  renderCalendar();
  if (sameDay(state.selectedDate, state.currentDate)) {
    renderTasks();
    renderStats();
  }
}

function renderCalendar() {
  const anchor = state.calendarMonth;
  const year = anchor.getFullYear();
  const month = anchor.getMonth();

  document.getElementById('calendar-month-title').textContent =
    anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay(); // 0 = Sunday
  const start = new Date(year, month, 1 - startWeekday);

  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = '';
  const today = new Date();

  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);

    const cell = document.createElement('div');
    cell.className = 'cal-cell';
    if (d.getMonth() !== month) cell.classList.add('other-month');
    if (sameDay(d, today)) cell.classList.add('today');
    if (sameDay(d, state.selectedDate)) cell.classList.add('selected');

    const num = document.createElement('div');
    num.className = 'cal-day-num';
    const numText = document.createElement('span');
    numText.textContent = d.getDate();
    num.appendChild(numText);
    if (sameDay(d, today)) {
      const pip = document.createElement('span');
      pip.className = 'cal-today-pip';
      pip.textContent = 'Today';
      num.appendChild(pip);
    }
    cell.appendChild(num);

    const key = dateKey(d);
    const dayTasks = state.tasks[key] || [];
    const dayExp = state.expenses[key] || [];

    // Red-day warning: any pool projected negative
    if (dayExp.length > 0) {
      const anyNeg = POOLS.some(p => getPoolBalance(p).projected < 0);
      if (anyNeg) cell.classList.add('cash-warning');
    }

    if (dayTasks.length > 0) {
      const done = dayTasks.filter(t => t.done).length;
      const dots = document.createElement('div');
      dots.className = 'cal-dots';
      const max = Math.min(dayTasks.length, 8);
      for (let j = 0; j < max; j++) {
        const dot = document.createElement('span');
        dot.className = 'cal-dot' + (j < done ? ' done' : '');
        dots.appendChild(dot);
      }
      cell.appendChild(dots);

      const count = document.createElement('div');
      count.className = 'cal-count';
      const badge = document.createElement('span');
      badge.className = 'cal-badge' + (done === dayTasks.length ? ' all-done' : '');
      badge.textContent = `${done}/${dayTasks.length}`;
      count.appendChild(badge);
      cell.appendChild(count);
    }

    const dayInc = state.income[key] || [];
    if (dayInc.length > 0) {
      const incTotal = dayInc.reduce((s, x) => s + (x.amount || 0), 0);
      const incLabel = document.createElement('div');
      incLabel.className = 'cal-income-total';
      incLabel.textContent = '+' + fmtMoney(incTotal);
      cell.appendChild(incLabel);
    }

    if (dayExp.length > 0) {
      const total = dayExp.reduce((s, e) => s + (e.amount || 0), 0);
      const expLabel = document.createElement('div');
      expLabel.className = 'cal-expense-total';
      expLabel.textContent = '-' + fmtMoney(total);
      cell.appendChild(expLabel);
    }

    cell.addEventListener('click', () => {
      state.selectedDate = new Date(d);
      // If user clicked an out-of-month day, jump the month view to follow
      if (d.getMonth() !== month) {
        state.calendarMonth = new Date(d);
      }
      renderCalendar();
    });

    grid.appendChild(cell);
  }

  renderCalendarTasks();
  renderIncomeSidebar();
  renderExpenses();
  renderCashTracker();
  renderDayNotes();
}

function renderCalendarTasks() {
  const d = state.selectedDate;
  const list = document.getElementById('day-task-list');
  const empty = document.getElementById('day-task-empty');
  const counter = document.getElementById('day-tasks-counter');
  const title = document.getElementById('day-tasks-title');
  const sub = document.getElementById('day-tasks-sub');

  const isToday = sameDay(d, new Date());
  title.textContent = isToday
    ? 'Today'
    : d.toLocaleDateString(undefined, { weekday: 'long' });
  sub.textContent = d.toLocaleDateString(undefined, {
    month: 'long', day: 'numeric', year: 'numeric'
  });

  const tasks = getDayTasks(d);
  list.innerHTML = '';
  empty.style.display = tasks.length === 0 ? 'block' : 'none';

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
      renderCalendarTasks();
      renderCalendar();
      if (sameDay(d, state.currentDate)) {
        renderTasks();
        renderStats();
      }
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

    // Edit button
    const editBtn = document.createElement('button');
    editBtn.className = 'task-icon-btn';
    editBtn.title = 'Edit';
    editBtn.innerHTML = '&#9998;';
    editBtn.addEventListener('click', () => {
      openTaskModalFor(task, d, afterCalendarTaskChange);
    });
    li.appendChild(editBtn);

    // Delete button
    const delBtn = document.createElement('button');
    delBtn.className = 'task-icon-btn danger';
    delBtn.title = 'Delete';
    delBtn.innerHTML = '&times;';
    delBtn.addEventListener('click', async () => {
      const dayTasks = getDayTasks(d);
      const i = dayTasks.findIndex(t => t.id === task.id);
      if (i >= 0) dayTasks.splice(i, 1);
      await saveTasks();
      renderCalendarTasks();
      renderCalendar();
      if (sameDay(d, state.currentDate)) {
        renderTasks();
        renderStats();
      }
    });
    li.appendChild(delBtn);

    list.appendChild(li);
  });
}

/* ------------------- POOLS & CONSTANTS ------------------- */
const POOLS = ['personal', 'business', 'flip_payments', 'renovation'];
const POOL_LABELS = { personal: 'Personal', business: 'Business', flip_payments: 'Flip Payments', renovation: 'Renovation' };

function expPool(e) { return e.pool || e.category || 'personal'; }

/* ------------------- EXPENSES & CASHFLOW ------------------- */
function getDayExpenses(date) {
  const d = date || state.selectedDate;
  const key = dateKey(d);
  if (!state.expenses[key]) state.expenses[key] = [];
  return state.expenses[key];
}

function nextRecurringDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  if (d.getDate() >= 29) { d.setDate(d.getDate() + 30); }
  else { d.setMonth(d.getMonth() + 1); }
  return dateKey(d);
}

function generateRecurring(expense, startDateStr, months) {
  const groupId = expense.recurringGroupId || expense.id;
  const limit = (!months || months === 0) ? 12 : months;
  let nextDate = startDateStr;
  for (let m = 0; m < limit; m++) {
    nextDate = nextRecurringDate(nextDate);
    if (!state.expenses[nextDate]) state.expenses[nextDate] = [];
    const alreadyExists = state.expenses[nextDate].some(
      e => e.recurringGroupId === groupId && e.label === expense.label
    );
    if (!alreadyExists) {
      state.expenses[nextDate].push({
        id: uid(), label: expense.label, notes: expense.notes,
        amount: expense.amount, pool: expense.pool,
        paid: false, recurring: true, recurringMonths: expense.recurringMonths,
        recurringGroupId: groupId, createdAt: Date.now()
      });
    }
  }
}

function getPoolBalance(pool) {
  const base = (state.cashflow.pools && state.cashflow.pools[pool]) || 0;
  const anchor = state.calendarMonth;
  const lastDay = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const cutoff = dateKey(lastDay);
  let paidExp = 0, recvInc = 0;
  for (const [key, exps] of Object.entries(state.expenses)) {
    if (key > cutoff) continue;
    for (const e of exps) {
      if (expPool(e) !== pool) continue;
      if (e.paid) paidExp += e.amount || 0;
    }
  }
  for (const [key, incs] of Object.entries(state.income)) {
    if (key > cutoff) continue;
    for (const inc of incs) {
      if ((inc.pool || 'personal') !== pool) continue;
      if (inc.received) recvInc += inc.amount || 0;
    }
  }
  return { onHand: base + recvInc - paidExp };
}

function getPoolCashNeeded(pool) {
  const base = (state.cashflow.pools && state.cashflow.pools[pool]) || 0;
  const allDates = new Set([...Object.keys(state.expenses), ...Object.keys(state.income)]);
  const sorted = [...allDates].sort();
  let running = base;
  for (const key of sorted) {
    for (const inc of (state.income[key] || [])) {
      if ((inc.pool || 'personal') === pool && inc.received) running += inc.amount || 0;
    }
    for (const e of (state.expenses[key] || [])) {
      if (expPool(e) === pool && e.paid) running -= e.amount || 0;
    }
  }
  let projected = running;
  let shortfallDate = null;
  let shortfallAmount = 0;
  for (const key of sorted) {
    for (const inc of (state.income[key] || [])) {
      if ((inc.pool || 'personal') === pool && !inc.received) projected += inc.amount || 0;
    }
    for (const e of (state.expenses[key] || [])) {
      if (expPool(e) === pool && !e.paid) {
        projected -= e.amount || 0;
        if (projected < 0 && !shortfallDate) {
          shortfallDate = key;
          shortfallAmount = Math.abs(projected);
        }
      }
    }
  }
  return { shortfallDate, shortfallAmount };
}

function renderCashTracker() {
  document.querySelectorAll('.pool-bal').forEach(el => {
    const pool = el.dataset.pool;
    const bal = getPoolBalance(pool);
    el.textContent = fmtMoney(bal.onHand);
    el.className = 'cash-value editable pool-bal' + (bal.onHand < 0 ? ' negative' : '');
  });
  POOLS.forEach(pool => {
    const need = getPoolCashNeeded(pool);
    const needEl = document.getElementById('need-' + pool);
    const dateEl = document.getElementById('need-date-' + pool);
    if (!needEl) return;
    if (need.shortfallDate) {
      needEl.textContent = fmtMoney(need.shortfallAmount);
      needEl.className = 'cash-value negative';
      const d = new Date(need.shortfallDate + 'T12:00:00');
      dateEl.textContent = 'by ' + d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      dateEl.className = 'need-date urgent';
    } else {
      needEl.textContent = '$0';
      needEl.className = 'cash-value';
      dateEl.textContent = 'All covered';
      dateEl.className = 'need-date';
    }
  });
}

function autoTaskForExpense(exp, dateStr, paid) {
  const key = dateStr;
  if (!state.tasks[key]) state.tasks[key] = [];
  const tag = `[EXP:${exp.id}]`;
  const existing = state.tasks[key].find(t => t.text.includes(tag));
  if (paid && !existing) {
    state.tasks[key].push({ id: uid(), text: `Paid: ${exp.label} ${tag}`, done: true, priority: 'none', createdAt: Date.now() });
  } else if (!paid && existing) {
    state.tasks[key] = state.tasks[key].filter(t => t !== existing);
  }
}

function autoTaskForIncome(inc, dateStr, received) {
  const key = dateStr;
  if (!state.tasks[key]) state.tasks[key] = [];
  const tag = `[INC:${inc.id}]`;
  const existing = state.tasks[key].find(t => t.text.includes(tag));
  if (received && !existing) {
    state.tasks[key].push({ id: uid(), text: `Received: ${inc.label} ${tag}`, done: true, priority: 'none', createdAt: Date.now() });
  } else if (!received && existing) {
    state.tasks[key] = state.tasks[key].filter(t => t !== existing);
  }
}

function renderExpenses() {
  const d = state.selectedDate;
  const dKey = dateKey(d);
  const list = document.getElementById('expense-list');
  const empty = document.getElementById('expense-empty');
  const expenses = getDayExpenses(d);
  const filtered = expenses.filter(e => state.calendarFilters[expPool(e)]);

  list.innerHTML = '';
  empty.style.display = filtered.length === 0 ? 'block' : 'none';

  filtered.forEach(exp => {
    const li = document.createElement('li');
    li.className = 'expense-item' + (exp.paid ? ' paid' : '');

    const cb = document.createElement('button');
    cb.className = 'expense-check';
    cb.title = exp.paid ? 'Paid' : 'Mark as paid';
    cb.addEventListener('click', async () => {
      exp.paid = !exp.paid;
      autoTaskForExpense(exp, dKey, exp.paid);
      await saveExpenses();
      await saveTasks();
      renderExpenses(); renderCashTracker(); renderCalendar(); renderCalendarTasks();
    });
    li.appendChild(cb);

    const info = document.createElement('div');
    info.className = 'expense-info';
    const label = document.createElement('div');
    label.className = 'expense-label';
    label.textContent = exp.label;
    if (exp.recurring) {
      const pip = document.createElement('span');
      pip.className = 'expense-recurring-pip';
      pip.textContent = '↻';
      label.appendChild(pip);
    }
    info.appendChild(label);
    if (exp.notes) {
      const n = document.createElement('div');
      n.className = 'expense-notes';
      n.textContent = exp.notes;
      info.appendChild(n);
    }
    li.appendChild(info);

    const poolBadge = document.createElement('span');
    poolBadge.className = 'pool-badge ' + expPool(exp);
    poolBadge.textContent = POOL_LABELS[expPool(exp)] || expPool(exp);
    li.appendChild(poolBadge);

    const amt = document.createElement('div');
    amt.className = 'expense-amount';
    amt.textContent = fmtMoney(exp.amount);
    li.appendChild(amt);

    const editBtn = document.createElement('button');
    editBtn.className = 'task-icon-btn';
    editBtn.title = 'Edit';
    editBtn.innerHTML = '&#9998;';
    editBtn.addEventListener('click', () => openExpenseModal(exp, d));
    li.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'task-icon-btn danger';
    delBtn.title = 'Delete';
    delBtn.innerHTML = '&times;';
    delBtn.addEventListener('click', async () => {
      const dayExp = getDayExpenses(d);
      const i = dayExp.findIndex(e => e.id === exp.id);
      if (i >= 0) dayExp.splice(i, 1);
      await saveExpenses();
      renderExpenses(); renderCashTracker(); renderCalendar();
    });
    li.appendChild(delBtn);

    list.appendChild(li);
  });
}

function openExpenseModal(existing, date) {
  const isEdit = !!existing;
  const niceDate = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const poolOpts = POOLS.map(p =>
    `<option value="${p}" ${(existing ? expPool(existing) : 'personal') === p ? 'selected' : ''}>${POOL_LABELS[p]}</option>`
  ).join('');
  const durOpts = ['<option value="0"' + ((!existing || !existing.recurringMonths) ? ' selected' : '') + '>Indefinite</option>']
    .concat(Array.from({length: 12}, (_, i) => {
      const m = i + 1;
      return `<option value="${m}" ${existing && existing.recurringMonths === m ? 'selected' : ''}>${m} month${m > 1 ? 's' : ''}</option>`;
    })).join('');

  openModal(isEdit ? `Edit Expense — ${niceDate}` : `Add Expense — ${niceDate}`, `
    <div>
      <label>Label</label>
      <input type="text" id="exp-label" placeholder="e.g. Hard money payment - 123 Main"
             value="${existing ? escapeAttr(existing.label) : ''}" maxlength="120" />
    </div>
    <div class="form-row">
      <div>
        <label>Amount ($)</label>
        <input type="number" id="exp-amount" placeholder="0.00" min="0" step="0.01"
               value="${existing ? existing.amount : ''}" />
      </div>
      <div>
        <label>Account / Pool</label>
        <select id="exp-pool">${poolOpts}</select>
      </div>
    </div>
    <div>
      <label>Notes</label>
      <textarea id="exp-notes" rows="2" placeholder="Contract details, account numbers...">${existing ? escapeAttr(existing.notes || '') : ''}</textarea>
    </div>
    <div style="display:flex;align-items:center;gap:10px;">
      <input type="checkbox" id="exp-recurring" style="width:auto;" ${existing && existing.recurring ? 'checked' : ''} />
      <label for="exp-recurring" style="margin:0;text-transform:none;letter-spacing:0;font-size:13px;color:var(--text);">Recurring monthly</label>
    </div>
    <div id="exp-dur-row" style="display:${existing && existing.recurring ? 'block' : 'none'};">
      <label>Recurring Duration</label>
      <select id="exp-duration">${durOpts}</select>
    </div>
  `, async () => {
    const label = document.getElementById('exp-label').value.trim();
    const amount = parseFloat(document.getElementById('exp-amount').value) || 0;
    const pool = document.getElementById('exp-pool').value;
    const notes = document.getElementById('exp-notes').value.trim();
    const recurring = document.getElementById('exp-recurring').checked;
    const recurringMonths = recurring ? parseInt(document.getElementById('exp-duration').value, 10) : 0;
    if (!label || amount <= 0) return;

    const dayExp = getDayExpenses(date);
    if (isEdit) {
      existing.label = label; existing.amount = amount;
      existing.pool = pool; existing.notes = notes;
      existing.recurring = recurring; existing.recurringMonths = recurringMonths;
    } else {
      const exp = {
        id: uid(), label, notes, amount, pool,
        paid: false, recurring, recurringMonths,
        recurringGroupId: null, createdAt: Date.now()
      };
      exp.recurringGroupId = exp.id;
      dayExp.push(exp);
      if (recurring) generateRecurring(exp, dateKey(date), recurringMonths);
    }
    await saveExpenses();
    closeModal();
    renderExpenses(); renderCashTracker(); renderCalendar();
  });
  // Toggle duration visibility
  const recCb = document.getElementById('exp-recurring');
  const durRow = document.getElementById('exp-dur-row');
  if (recCb && durRow) {
    recCb.addEventListener('change', () => { durRow.style.display = recCb.checked ? 'block' : 'none'; });
  }
}

/* ------------------- INCOME ------------------- */
function getDayIncome(date) {
  const d = date || state.selectedDate;
  const key = dateKey(d);
  if (!state.income[key]) state.income[key] = [];
  return state.income[key];
}

function renderIncomeSidebar() {
  const d = state.selectedDate;
  const dKey = dateKey(d);
  const list = document.getElementById('income-list');
  const empty = document.getElementById('income-empty');
  const items = getDayIncome(d).filter(inc => state.calendarFilters[inc.pool || 'personal']);

  list.innerHTML = '';
  empty.style.display = items.length === 0 ? 'block' : 'none';

  items.forEach(inc => {
    const li = document.createElement('li');
    li.className = 'expense-item' + (inc.received ? ' paid' : '');

    const cb = document.createElement('button');
    cb.className = 'expense-check';
    cb.title = inc.received ? 'Received' : 'Mark received';
    cb.addEventListener('click', async () => {
      inc.received = !inc.received;
      autoTaskForIncome(inc, dKey, inc.received);
      await saveIncome();
      await saveTasks();
      renderIncomeSidebar(); renderCashTracker(); renderCalendar(); renderCalendarTasks();
    });
    li.appendChild(cb);

    const info = document.createElement('div');
    info.className = 'expense-info';
    const label = document.createElement('div');
    label.className = 'expense-label';
    label.textContent = inc.label;
    info.appendChild(label);
    if (inc.notes) {
      const n = document.createElement('div');
      n.className = 'expense-notes';
      n.textContent = inc.notes;
      info.appendChild(n);
    }
    li.appendChild(info);

    const poolBadge = document.createElement('span');
    poolBadge.className = 'pool-badge ' + (inc.pool || 'personal');
    poolBadge.textContent = POOL_LABELS[inc.pool || 'personal'];
    li.appendChild(poolBadge);

    const amt = document.createElement('div');
    amt.className = 'expense-amount';
    amt.textContent = '+' + fmtMoney(inc.amount);
    li.appendChild(amt);

    const delBtn = document.createElement('button');
    delBtn.className = 'task-icon-btn danger';
    delBtn.title = 'Delete';
    delBtn.innerHTML = '&times;';
    delBtn.addEventListener('click', async () => {
      const dayInc = getDayIncome(d);
      const i = dayInc.findIndex(x => x.id === inc.id);
      if (i >= 0) dayInc.splice(i, 1);
      await saveIncome();
      renderIncomeSidebar(); renderCashTracker(); renderCalendar();
    });
    li.appendChild(delBtn);

    list.appendChild(li);
  });
}

function openIncomeModal(date) {
  const niceDate = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const poolOpts = POOLS.map(p => `<option value="${p}">${POOL_LABELS[p]}</option>`).join('');
  openModal(`Add Income — ${niceDate}`, `
    <div>
      <label>Source</label>
      <input type="text" id="inc-label" placeholder="e.g. Investor funding - Johnson" maxlength="120" />
    </div>
    <div class="form-row">
      <div>
        <label>Amount ($)</label>
        <input type="number" id="inc-amount" placeholder="0.00" min="0" step="0.01" />
      </div>
      <div>
        <label>Account / Pool</label>
        <select id="inc-pool">${poolOpts}</select>
      </div>
    </div>
    <div>
      <label>Notes</label>
      <textarea id="inc-notes" rows="2" placeholder="Wire details, source, etc."></textarea>
    </div>
  `, async () => {
    const label = document.getElementById('inc-label').value.trim();
    const amount = parseFloat(document.getElementById('inc-amount').value) || 0;
    const pool = document.getElementById('inc-pool').value;
    const notes = document.getElementById('inc-notes').value.trim();
    if (!label || amount <= 0) return;
    const dayInc = getDayIncome(date);
    dayInc.push({ id: uid(), label, amount, pool, notes, received: false, createdAt: Date.now() });
    await saveIncome();
    closeModal();
    renderIncomeSidebar(); renderCashTracker(); renderCalendar();
  });
}

/* ------------------- DAILY NOTES ------------------- */
function renderDayNotes() {
  const key = dateKey(state.selectedDate);
  const el = document.getElementById('day-notes');
  el.value = state.notes[key] || '';
}

function initDayNotes() {
  const el = document.getElementById('day-notes');
  let saveTimer = null;
  el.addEventListener('input', () => {
    const key = dateKey(state.selectedDate);
    state.notes[key] = el.value;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveNotes(), 600);
  });
}

/* ------------------- UPCOMING DEADLINES ------------------- */
function renderDeadlines() {
  const list = document.getElementById('deadline-list');
  const empty = document.getElementById('deadline-empty');
  if (!list) return;
  list.innerHTML = '';

  const items = [];
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const key = dateKey(d);
    const shortDate = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

    (state.expenses[key] || []).forEach(e => {
      if (!e.paid) items.push({ date: shortDate, label: e.label, amount: e.amount, type: 'expense' });
    });
    (state.tasks[key] || []).forEach(t => {
      if (!t.done) items.push({ date: shortDate, label: t.text, amount: null, type: 'task' });
    });
  }

  empty.style.display = items.length === 0 ? 'block' : 'none';

  items.forEach(item => {
    const li = document.createElement('li');
    li.className = 'deadline-item';

    const date = document.createElement('div');
    date.className = 'deadline-date';
    date.textContent = item.date;
    li.appendChild(date);

    const label = document.createElement('div');
    label.className = 'deadline-label';
    label.textContent = item.label;
    li.appendChild(label);

    const tag = document.createElement('span');
    tag.className = 'deadline-type ' + item.type;
    tag.textContent = item.type === 'expense' ? 'Expense' : 'Task';
    li.appendChild(tag);

    if (item.amount) {
      const amt = document.createElement('div');
      amt.className = 'deadline-amount';
      amt.textContent = fmtMoney(item.amount);
      li.appendChild(amt);
    }

    list.appendChild(li);
  });
}

/* ------------------- DEAL PIPELINE ------------------- */
const DEAL_STAGES = ['lead', 'under_contract', 'due_diligence', 'closing', 'closed'];
const STAGE_LABELS = { lead: 'Lead', under_contract: 'Under Contract', due_diligence: 'Due Diligence', closing: 'Closing', closed: 'Closed' };

function renderDeals() {
  DEAL_STAGES.forEach(stage => {
    const col = document.getElementById('kanban-' + stage);
    if (!col) return;
    col.innerHTML = '';
    state.deals.filter(d => d.stage === stage).forEach(deal => {
      col.appendChild(createDealCard(deal));
    });
  });
}

function createDealCard(deal) {
  const card = document.createElement('div');
  card.className = 'deal-card';

  const addr = document.createElement('div');
  addr.className = 'deal-address';
  addr.textContent = deal.address || 'No address';
  card.appendChild(addr);

  const meta = document.createElement('div');
  meta.className = 'deal-meta-row';
  if (deal.purchasePrice) {
    const pp = document.createElement('span');
    pp.className = 'deal-meta-tag';
    pp.innerHTML = `PP: <b>${fmtMoney(deal.purchasePrice)}</b>`;
    meta.appendChild(pp);
  }
  if (deal.arv) {
    const arv = document.createElement('span');
    arv.className = 'deal-meta-tag';
    arv.innerHTML = `ARV: <b>${fmtMoney(deal.arv)}</b>`;
    meta.appendChild(arv);
  }
  if (deal.notes) {
    const n = document.createElement('span');
    n.className = 'deal-meta-tag';
    n.textContent = deal.notes;
    meta.appendChild(n);
  }
  card.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'deal-actions';

  const si = DEAL_STAGES.indexOf(deal.stage);
  if (si > 0) {
    const backBtn = document.createElement('button');
    backBtn.textContent = '← ' + STAGE_LABELS[DEAL_STAGES[si - 1]];
    backBtn.addEventListener('click', async () => {
      deal.stage = DEAL_STAGES[si - 1];
      await saveDeals();
      renderDeals();
    });
    actions.appendChild(backBtn);
  }
  if (si < DEAL_STAGES.length - 1) {
    const fwdBtn = document.createElement('button');
    fwdBtn.className = 'advance';
    fwdBtn.textContent = STAGE_LABELS[DEAL_STAGES[si + 1]] + ' →';
    fwdBtn.addEventListener('click', async () => {
      deal.stage = DEAL_STAGES[si + 1];
      await saveDeals();
      renderDeals();
    });
    actions.appendChild(fwdBtn);
  }

  const editBtn = document.createElement('button');
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', () => openDealModal(deal));
  actions.appendChild(editBtn);

  const delBtn = document.createElement('button');
  delBtn.className = 'danger';
  delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', async () => {
    state.deals = state.deals.filter(d => d.id !== deal.id);
    await saveDeals();
    renderDeals();
  });
  actions.appendChild(delBtn);

  card.appendChild(actions);
  return card;
}

function openDealModal(existing) {
  const isEdit = !!existing;
  openModal(isEdit ? 'Edit Deal' : 'New Deal', `
    <div>
      <label>Property Address</label>
      <input type="text" id="deal-address" placeholder="123 Main St, City, ST" maxlength="200"
             value="${existing ? escapeAttr(existing.address) : ''}" />
    </div>
    <div class="form-row">
      <div>
        <label>Purchase Price ($)</label>
        <input type="number" id="deal-pp" placeholder="0" min="0"
               value="${existing ? existing.purchasePrice || '' : ''}" />
      </div>
      <div>
        <label>ARV ($)</label>
        <input type="number" id="deal-arv" placeholder="0" min="0"
               value="${existing ? existing.arv || '' : ''}" />
      </div>
    </div>
    <div>
      <label>Notes</label>
      <textarea id="deal-notes" rows="2" placeholder="Key dates, contract terms...">${existing ? escapeAttr(existing.notes || '') : ''}</textarea>
    </div>
  `, async () => {
    const address = document.getElementById('deal-address').value.trim();
    if (!address) return;
    const pp = parseFloat(document.getElementById('deal-pp').value) || 0;
    const arv = parseFloat(document.getElementById('deal-arv').value) || 0;
    const notes = document.getElementById('deal-notes').value.trim();
    if (isEdit) {
      existing.address = address;
      existing.purchasePrice = pp;
      existing.arv = arv;
      existing.notes = notes;
    } else {
      state.deals.push({ id: uid(), address, purchasePrice: pp, arv, notes, stage: 'lead', createdAt: Date.now() });
    }
    await saveDeals();
    closeModal();
    renderDeals();
  });
}

/* ------------------- INVESTORS ------------------- */
function getInvestorExpenses(investor) {
  const name = investor.name.toLowerCase();
  const results = [];
  for (const [dateStr, exps] of Object.entries(state.expenses)) {
    for (const e of exps) {
      if (e.category === 'investor_debt' && e.label.toLowerCase().includes(name)) {
        results.push({ ...e, dateStr });
      }
    }
  }
  results.sort((a, b) => a.dateStr.localeCompare(b.dateStr));
  return results;
}

function renderInvestors() {
  const grid = document.getElementById('investor-grid');
  const empty = document.getElementById('investor-empty');
  if (!grid) return;
  grid.innerHTML = '';
  empty.style.display = state.investors.length === 0 ? 'block' : 'none';

  state.investors.forEach(inv => {
    const card = document.createElement('div');
    card.className = 'investor-card';

    const name = document.createElement('div');
    name.className = 'investor-name';
    name.textContent = inv.name;
    card.appendChild(name);

    if (inv.notes) {
      const notes = document.createElement('div');
      notes.className = 'investor-notes';
      notes.textContent = inv.notes;
      card.appendChild(notes);
    }

    const expenses = getInvestorExpenses(inv);
    const totalOwed = expenses.reduce((s, e) => s + (e.amount || 0), 0);
    const totalPaid = expenses.filter(e => e.paid).reduce((s, e) => s + (e.amount || 0), 0);
    const outstanding = totalOwed - totalPaid;
    const activeDeals = state.deals.filter(d => d.stage !== 'closed').length;

    const stats = document.createElement('div');
    stats.className = 'investor-stats';
    [
      ['Capital Deployed', fmtMoney(inv.capitalDeployed || 0)],
      ['Returns Paid', fmtMoney(totalPaid)],
      ['Outstanding', fmtMoney(outstanding)]
    ].forEach(([label, value]) => {
      const s = document.createElement('div');
      s.className = 'investor-stat';
      s.innerHTML = `<div class="stat-label">${label}</div><div class="stat-value">${value}</div>`;
      stats.appendChild(s);
    });
    card.appendChild(stats);

    if (expenses.length > 0) {
      const history = document.createElement('div');
      history.className = 'investor-history';
      const hTitle = document.createElement('div');
      hTitle.className = 'investor-history-title';
      hTitle.textContent = 'Payment History';
      history.appendChild(hTitle);

      expenses.forEach(e => {
        const row = document.createElement('div');
        row.className = 'history-row';
        const d = new Date(e.dateStr + 'T12:00:00');
        row.innerHTML = `
          <span class="h-date">${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
          <span class="h-label">${escapeAttr(e.label)}</span>
          <span class="h-amount ${e.paid ? 'paid' : ''}">${fmtMoney(e.amount)}</span>
        `;
        history.appendChild(row);
      });
      card.appendChild(history);
    }

    const actions = document.createElement('div');
    actions.className = 'investor-card-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'icon-btn';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => openInvestorModal(inv));
    actions.appendChild(editBtn);
    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn danger';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async () => {
      state.investors = state.investors.filter(x => x.id !== inv.id);
      await saveInvestors();
      renderInvestors();
    });
    actions.appendChild(delBtn);
    card.appendChild(actions);

    grid.appendChild(card);
  });
}

function openInvestorModal(existing) {
  const isEdit = !!existing;
  openModal(isEdit ? 'Edit Investor' : 'Add Investor', `
    <div>
      <label>Name</label>
      <input type="text" id="inv-name" placeholder="John Smith" maxlength="100"
             value="${existing ? escapeAttr(existing.name) : ''}" />
    </div>
    <div>
      <label>Capital Deployed ($)</label>
      <input type="number" id="inv-capital" placeholder="0" min="0"
             value="${existing ? existing.capitalDeployed || '' : ''}" />
    </div>
    <div>
      <label>Notes</label>
      <textarea id="inv-notes" rows="2" placeholder="Terms, contact info...">${existing ? escapeAttr(existing.notes || '') : ''}</textarea>
    </div>
  `, async () => {
    const name = document.getElementById('inv-name').value.trim();
    if (!name) return;
    const capital = parseFloat(document.getElementById('inv-capital').value) || 0;
    const notes = document.getElementById('inv-notes').value.trim();
    if (isEdit) {
      existing.name = name;
      existing.capitalDeployed = capital;
      existing.notes = notes;
    } else {
      state.investors.push({ id: uid(), name, capitalDeployed: capital, notes, createdAt: Date.now() });
    }
    await saveInvestors();
    closeModal();
    renderInvestors();
  });
}

function openSetPoolBalanceModal(pool) {
  const cf = state.cashflow;
  if (!cf.pools) cf.pools = {};
  openModal(`Set ${POOL_LABELS[pool]} Reserve`, `
    <div>
      <label>Current Reserve Balance ($)</label>
      <input type="number" id="pool-bal-input" placeholder="20000" min="0" step="0.01"
             value="${cf.pools[pool] || ''}" />
    </div>
  `, async () => {
    cf.pools[pool] = parseFloat(document.getElementById('pool-bal-input').value) || 0;
    await saveCashflow();
    closeModal();
    renderCashTracker();
    renderCalendar();
  });
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

function openTaskModalFor(existing, date, afterSave) {
  const isEdit = !!existing;
  const niceDate = date.toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric'
  });
  openModal(isEdit ? `Edit Task — ${niceDate}` : `Add Task — ${niceDate}`, `
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
    const tasks = getDayTasks(date);
    if (isEdit) {
      existing.text = text;
      existing.priority = priority;
    } else {
      tasks.push({ id: uid(), text, done: false, priority, createdAt: Date.now() });
    }
    await saveTasks();
    closeModal();
    if (afterSave) afterSave();
  });
}

function openTaskModal(existing) {
  openTaskModalFor(existing, state.currentDate, () => {
    renderTasks();
    renderStats();
    if (sameDay(state.currentDate, state.selectedDate)) renderCalendar();
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
function migrateHabitHistory() {
  // Convert legacy habits (single lastChecked field) into history-array form.
  state.habits.habits.forEach(h => {
    if (!Array.isArray(h.history)) {
      h.history = h.lastChecked ? [h.lastChecked] : [];
    }
  });
}

function calcStreak(habit) {
  const set = new Set(habit.history || []);
  if (set.size === 0) return 0;
  let streak = 0;
  const d = new Date();
  while (set.has(dateKey(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function focusDateLabel() {
  const d = state.currentDate;
  const now = new Date();
  if (sameDay(d, now)) return 'today';
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (sameDay(d, y)) return 'yesterday';
  const t = new Date(now); t.setDate(t.getDate() + 1);
  if (sameDay(d, t)) return 'tomorrow';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function renderFocusHeader() {
  const sub = document.getElementById('focus-subline');
  if (sub) sub.textContent = `Tracking habits for ${focusDateLabel()}.`;
}

function renderHabits() {
  renderFocusHeader();
  const list = document.getElementById('habit-list');
  const empty = document.getElementById('habit-empty');
  list.innerHTML = '';

  if (state.habits.habits.length === 0) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  const dKey = dateKey(state.currentDate);
  const dayLabel = focusDateLabel();

  state.habits.habits.forEach(habit => {
    if (!Array.isArray(habit.history)) habit.history = [];
    const li = document.createElement('li');
    li.className = 'habit-item';

    const checkedThatDay = habit.history.includes(dKey);

    const check = document.createElement('button');
    check.className = 'habit-check' + (checkedThatDay ? ' checked' : '');
    check.title = checkedThatDay ? `Checked in for ${dayLabel}` : `Check in for ${dayLabel}`;
    check.addEventListener('click', async () => { await toggleHabit(habit); });
    li.appendChild(check);

    const info = document.createElement('div');
    info.className = 'habit-info';
    const name = document.createElement('div');
    name.className = 'habit-name';
    name.textContent = habit.name;
    info.appendChild(name);
    const sub = document.createElement('div');
    sub.className = 'habit-sub';
    sub.textContent = checkedThatDay
      ? `Checked in for ${dayLabel} — keep it rolling`
      : `Tap to check in for ${dayLabel}`;
    info.appendChild(sub);
    li.appendChild(info);

    const badge = document.createElement('div');
    badge.className = 'streak-badge';
    badge.textContent = `${calcStreak(habit)}`;
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
  if (!Array.isArray(habit.history)) habit.history = [];
  const dKey = dateKey(state.currentDate);
  const idx = habit.history.indexOf(dKey);
  if (idx >= 0) habit.history.splice(idx, 1);
  else habit.history.push(dKey);
  habit.streak = calcStreak(habit);
  habit.lastChecked = habit.history.length ? [...habit.history].sort().pop() : null;
  await saveHabits();
  renderHabits();
  renderStats();
}

function initFocusDayNav() {
  const prev = document.getElementById('focus-prev');
  const next = document.getElementById('focus-next');
  const today = document.getElementById('focus-today');
  if (prev) prev.addEventListener('click', () => shiftDay(-1));
  if (next) next.addEventListener('click', () => shiftDay(+1));
  if (today) today.addEventListener('click', () => {
    state.currentDate = new Date();
    renderHeader(); renderTasks(); renderStats(); renderHabits();
  });
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
      history: [],
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

/* ------------------- AI COMMAND BAR ------------------- */
const CMD_PLACEHOLDERS = [
  'Add a $45k rehab loan owed May 15th...',
  'Mark the Phoenix note as paid today...',
  'Add tasks: call contractor Mon, inspect site Tue...',
  'Set renovation reserve to $20,000...',
  'Add deal at 742 Evergreen Terrace, PP $180k, ARV $280k...',
  'What expenses do I have this month?...',
  'Add $5,500 investor income for Wednesday...',
];
let cmdPlaceholderIdx = 0;
let cmdPlaceholderTimer = null;

function initCommandBar() {
  const input = document.getElementById('cmd-input');
  const responseArea = document.getElementById('cmd-response');
  const messagesEl = document.getElementById('cmd-messages');
  const wrap = document.querySelector('.cmd-input-wrap');
  if (!input || !bridge.ai) return;

  // Rotating placeholders
  cmdPlaceholderTimer = setInterval(() => {
    cmdPlaceholderIdx = (cmdPlaceholderIdx + 1) % CMD_PLACEHOLDERS.length;
    input.placeholder = CMD_PLACEHOLDERS[cmdPlaceholderIdx];
  }, 4000);

  // Ctrl+K focus
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      input.focus();
    }
  });

  // Listen for AI events
  bridge.ai.clearListeners();
  bridge.ai.onChunk((text) => {
    let last = messagesEl.querySelector('.cmd-msg.assistant:last-child');
    if (!last) {
      last = document.createElement('div');
      last.className = 'cmd-msg assistant';
      messagesEl.appendChild(last);
    }
    last.textContent += text;
    responseArea.scrollTop = responseArea.scrollHeight;
  });

  bridge.ai.onToolCall((tc) => {
    const card = document.createElement('div');
    card.className = 'cmd-confirm' + (tc.destructive ? ' destructive' : '');
    card.innerHTML = `
      <div class="cmd-confirm-title">${tc.destructive ? 'Destructive Action' : 'Confirm Action'}</div>
      <div class="cmd-confirm-desc">${escapeAttr(tc.description)}</div>
      <div class="cmd-confirm-params">${JSON.stringify(tc.input, null, 2)}</div>
      <div class="cmd-confirm-btns">
        <button class="btn primary cmd-yes">Confirm</button>
        <button class="btn secondary cmd-no">Cancel</button>
      </div>
    `;
    messagesEl.appendChild(card);
    responseArea.scrollTop = responseArea.scrollHeight;

    card.querySelector('.cmd-yes').addEventListener('click', () => {
      bridge.ai.confirm(true);
      card.querySelector('.cmd-confirm-btns').innerHTML = '<span style="color:var(--success);font-size:12px;font-weight:700;">Confirmed</span>';
    });
    card.querySelector('.cmd-no').addEventListener('click', () => {
      bridge.ai.confirm(false);
      card.querySelector('.cmd-confirm-btns').innerHTML = '<span style="color:var(--text-muted);font-size:12px;font-weight:700;">Cancelled</span>';
    });
  });

  bridge.ai.onDataChanged(() => {
    safeStep('reload-after-ai', async () => {
      await loadAll();
      renderTasks(); renderStats(); renderCalendar(); renderExpenses();
      renderIncomeSidebar(); renderCashTracker(); renderDeals(); renderInvestors();
      renderHabits(); renderDeadlines(); renderDayNotes(); renderCalendarTasks();
    });
  });

  // Submit
  input.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const msg = input.value.trim();
    if (!msg) return;
    e.preventDefault();
    input.value = '';

    responseArea.classList.remove('hidden');
    const userEl = document.createElement('div');
    userEl.className = 'cmd-msg user';
    userEl.textContent = '> ' + msg;
    messagesEl.appendChild(userEl);
    wrap.classList.add('thinking');
    responseArea.scrollTop = responseArea.scrollHeight;

    const result = await bridge.ai.chat(msg);
    wrap.classList.remove('thinking');

    if (result && result.error) {
      const errEl = document.createElement('div');
      errEl.className = 'cmd-msg error';
      errEl.textContent = result.error;
      messagesEl.appendChild(errEl);
    }
    responseArea.scrollTop = responseArea.scrollHeight;
  });

  // Click outside to collapse
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.cmd-bar') && !responseArea.classList.contains('hidden')) {
      responseArea.classList.add('hidden');
    }
  });
  input.addEventListener('focus', () => {
    if (messagesEl.children.length > 0) {
      responseArea.classList.remove('hidden');
    }
  });
}

/* History-based habits: streak is auto-calculated from history every render,
 * so no manual reconciliation needed when a day is skipped. */

/* ------------------- INIT ------------------- */
// Defensive wrapper: run a step, log any failure, keep going. Prevents one
// broken init step from leaving the whole UI stuck on "Loading…".
function safeStep(label, fn) {
  try { fn(); } catch (err) { console.error(`[init:${label}]`, err); }
}

async function init() {
  // Render the header first so the "Loading…" placeholder is replaced
  // immediately, even before we try to touch storage.
  safeStep('renderHeader', renderHeader);
  safeStep('tickClock', tickClock);

  if (!bridge || !bridge.store) {
    console.error('[init] window.api bridge missing — preload script did not load');
    alert('Dashboard failed to start: storage bridge unavailable');
    return;
  }

  try {
    await loadAll();
  } catch (err) {
    console.error('[init:loadAll]', err);
    // Fall through with empty defaults so the UI still works.
    state.tasks = state.tasks || {};
    state.habits = state.habits || { habits: [], pomodoro: { sessionsToday: 0, lastDate: null, totalMinutes: 0 } };
  }

  safeStep('migrateHabitHistory', migrateHabitHistory);
  try { await saveHabits(); } catch (err) { console.error('[init:saveHabits]', err); }

  safeStep('initTabs', initTabs);
  safeStep('initDayNav', initDayNav);
  safeStep('initFocusDayNav', initFocusDayNav);
  safeStep('initCalendar', initCalendar);
  safeStep('initDayNotes', initDayNotes);
  safeStep('initPomodoro', initPomodoro);

  safeStep('add-task-btn listener', () => {
    document.getElementById('add-task-btn').addEventListener('click', () => openTaskModal(null));
  });
  safeStep('add-habit-btn listener', () => {
    document.getElementById('add-habit-btn').addEventListener('click', openHabitModal);
  });
  safeStep('add-deal-btn listener', () => {
    document.getElementById('add-deal-btn').addEventListener('click', () => openDealModal(null));
  });
  safeStep('add-investor-btn listener', () => {
    document.getElementById('add-investor-btn').addEventListener('click', () => openInvestorModal(null));
  });

  safeStep('renderHeader (post-load)', renderHeader);
  safeStep('renderTasks', renderTasks);
  safeStep('renderStats', renderStats);
  safeStep('renderDeadlines', renderDeadlines);
  safeStep('renderCalendar', renderCalendar);
  safeStep('renderExpenses', renderExpenses);
  safeStep('renderIncomeSidebar', renderIncomeSidebar);
  safeStep('renderCashTracker', renderCashTracker);
  safeStep('renderDayNotes', renderDayNotes);
  safeStep('renderDeals', renderDeals);
  safeStep('renderInvestors', renderInvestors);
  safeStep('renderHabits', renderHabits);
  safeStep('initCommandBar', initCommandBar);

  setInterval(() => safeStep('tickClock', tickClock), 1000);

  // Auto-refresh header/greeting at midnight flip
  setInterval(() => {
    const now = new Date();
    if (sameDay(state.currentDate, now)) {
      safeStep('renderHeader (interval)', renderHeader);
    }
  }, 30000);
}

init().catch(err => {
  console.error('Init failed', err);
  alert('Dashboard failed to start: ' + err.message);
});
