/* ai-tools.js — Claude tool definitions and executors for the dashboard */
const path = require('path');
const fs = require('fs');

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

const TOOL_SCHEMAS = [
  {
    name: 'add_expense',
    description: 'Add an expense to a specific date. Use pool to specify which money reserve it draws from.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        label: { type: 'string', description: 'Name of the expense' },
        amount: { type: 'number', description: 'Dollar amount' },
        pool: { type: 'string', enum: ['personal', 'business', 'flip_payments', 'renovation'] },
        notes: { type: 'string', description: 'Extra details (optional)' },
        recurring: { type: 'boolean', description: 'Repeats monthly' },
        recurringMonths: { type: 'integer', description: '0=indefinite, 1-12=fixed months' }
      },
      required: ['date', 'label', 'amount', 'pool']
    },
    mutates: true,
    describe: (i) => `Add expense "${i.label}" for $${i.amount} on ${i.date} (${i.pool})`
  },
  {
    name: 'add_income',
    description: 'Add income/deposit to a specific date.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        label: { type: 'string', description: 'Source of income' },
        amount: { type: 'number', description: 'Dollar amount' },
        pool: { type: 'string', enum: ['personal', 'business', 'flip_payments', 'renovation'] },
        notes: { type: 'string' }
      },
      required: ['date', 'label', 'amount', 'pool']
    },
    mutates: true,
    describe: (i) => `Add income "${i.label}" for $${i.amount} on ${i.date} (${i.pool})`
  },
  {
    name: 'add_task',
    description: 'Add a to-do task to a specific date.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        text: { type: 'string', description: 'Task description' },
        priority: { type: 'string', enum: ['none', 'low', 'med', 'high'] }
      },
      required: ['date', 'text']
    },
    mutates: true,
    describe: (i) => `Add task "${i.text}" on ${i.date}`
  },
  {
    name: 'add_tasks_bulk',
    description: 'Add multiple tasks across one or more dates at once.',
    input_schema: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              date: { type: 'string' },
              text: { type: 'string' },
              priority: { type: 'string', enum: ['none', 'low', 'med', 'high'] }
            },
            required: ['date', 'text']
          }
        }
      },
      required: ['tasks']
    },
    mutates: true,
    describe: (i) => `Add ${i.tasks.length} tasks across ${new Set(i.tasks.map(t => t.date)).size} day(s)`
  },
  {
    name: 'mark_expense_paid',
    description: 'Mark an expense as paid or unpaid by matching its label on a given date.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        label: { type: 'string', description: 'Expense label to match (partial match OK)' },
        paid: { type: 'boolean' }
      },
      required: ['date', 'label', 'paid']
    },
    mutates: true,
    describe: (i) => `Mark "${i.label}" on ${i.date} as ${i.paid ? 'paid' : 'unpaid'}`
  },
  {
    name: 'mark_income_received',
    description: 'Mark income as received or not received.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        label: { type: 'string', description: 'Income label to match' },
        received: { type: 'boolean' }
      },
      required: ['date', 'label', 'received']
    },
    mutates: true,
    describe: (i) => `Mark "${i.label}" on ${i.date} as ${i.received ? 'received' : 'not received'}`
  },
  {
    name: 'delete_expense',
    description: 'Delete an expense by matching its label on a given date.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string' },
        label: { type: 'string', description: 'Expense label to match' }
      },
      required: ['date', 'label']
    },
    mutates: true,
    destructive: true,
    describe: (i) => `DELETE expense "${i.label}" on ${i.date}`
  },
  {
    name: 'add_deal',
    description: 'Add a deal to the pipeline.',
    input_schema: {
      type: 'object',
      properties: {
        address: { type: 'string' },
        purchasePrice: { type: 'number' },
        arv: { type: 'number', description: 'After-repair value' },
        notes: { type: 'string' },
        stage: { type: 'string', enum: ['lead', 'under_contract', 'due_diligence', 'closing', 'closed'] }
      },
      required: ['address']
    },
    mutates: true,
    describe: (i) => `Add deal at "${i.address}" (${i.stage || 'lead'})`
  },
  {
    name: 'update_deal_stage',
    description: 'Move a deal to a different pipeline stage by matching its address.',
    input_schema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Partial address match' },
        stage: { type: 'string', enum: ['lead', 'under_contract', 'due_diligence', 'closing', 'closed'] }
      },
      required: ['address', 'stage']
    },
    mutates: true,
    describe: (i) => `Move "${i.address}" to ${i.stage}`
  },
  {
    name: 'set_pool_balance',
    description: 'Set the starting reserve balance for a money pool.',
    input_schema: {
      type: 'object',
      properties: {
        pool: { type: 'string', enum: ['personal', 'business', 'flip_payments', 'renovation'] },
        amount: { type: 'number' }
      },
      required: ['pool', 'amount']
    },
    mutates: true,
    describe: (i) => `Set ${i.pool} reserve to $${i.amount}`
  },
  {
    name: 'add_investor',
    description: 'Add an investor profile.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        capitalDeployed: { type: 'number' },
        notes: { type: 'string' }
      },
      required: ['name']
    },
    mutates: true,
    describe: (i) => `Add investor "${i.name}"`
  },
  {
    name: 'set_day_note',
    description: 'Set or append to the daily note for a given date.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string' },
        text: { type: 'string' }
      },
      required: ['date', 'text']
    },
    mutates: true,
    describe: (i) => `Set note for ${i.date}`
  },
  {
    name: 'query_data',
    description: 'Read data from the dashboard. Use to look up expenses, income, tasks, deals, investors, or pool balances for any date range.',
    input_schema: {
      type: 'object',
      properties: {
        dataType: { type: 'string', enum: ['expenses', 'income', 'tasks', 'deals', 'investors', 'pools', 'notes'] },
        from: { type: 'string', description: 'Start date YYYY-MM-DD (optional)' },
        to: { type: 'string', description: 'End date YYYY-MM-DD (optional)' }
      },
      required: ['dataType']
    },
    mutates: false,
    describe: (i) => `Query ${i.dataType}${i.from ? ` from ${i.from}` : ''}${i.to ? ` to ${i.to}` : ''}`
  }
];

function nextRecurringDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  if (d.getDate() >= 29) d.setDate(d.getDate() + 30);
  else d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function generateRecurring(expenses, expense, startDate, months) {
  const groupId = expense.recurringGroupId || expense.id;
  const limit = (!months || months === 0) ? 12 : months;
  let next = startDate;
  for (let m = 0; m < limit; m++) {
    next = nextRecurringDate(next);
    if (!expenses[next]) expenses[next] = [];
    if (!expenses[next].some(e => e.recurringGroupId === groupId && e.label === expense.label)) {
      expenses[next].push({
        id: uid(), label: expense.label, notes: expense.notes || '',
        amount: expense.amount, pool: expense.pool,
        paid: false, recurring: true, recurringMonths: expense.recurringMonths || 0,
        recurringGroupId: groupId, createdAt: Date.now()
      });
    }
  }
}

function executeTool(name, input, store) {
  const { readJson, writeJson, FILES, DEFAULTS } = store;

  switch (name) {
    case 'add_expense': {
      const expenses = readJson(FILES.expenses, DEFAULTS.expenses);
      if (!expenses[input.date]) expenses[input.date] = [];
      const exp = {
        id: uid(), label: input.label, notes: input.notes || '',
        amount: input.amount, pool: input.pool,
        paid: false, recurring: !!input.recurring,
        recurringMonths: input.recurringMonths || 0,
        recurringGroupId: null, createdAt: Date.now()
      };
      exp.recurringGroupId = exp.id;
      expenses[input.date].push(exp);
      if (exp.recurring) generateRecurring(expenses, exp, input.date, exp.recurringMonths);
      writeJson(FILES.expenses, expenses);
      return { success: true, message: `Added expense "${input.label}" for $${input.amount} on ${input.date}` };
    }
    case 'add_income': {
      const income = readJson(FILES.income, DEFAULTS.income);
      if (!income[input.date]) income[input.date] = [];
      income[input.date].push({
        id: uid(), label: input.label, amount: input.amount,
        pool: input.pool, notes: input.notes || '',
        received: false, createdAt: Date.now()
      });
      writeJson(FILES.income, income);
      return { success: true, message: `Added income "${input.label}" for $${input.amount} on ${input.date}` };
    }
    case 'add_task': {
      const tasks = readJson(FILES.tasks, DEFAULTS.tasks);
      if (!tasks[input.date]) tasks[input.date] = [];
      tasks[input.date].push({
        id: uid(), text: input.text, done: false,
        priority: input.priority || 'none', createdAt: Date.now()
      });
      writeJson(FILES.tasks, tasks);
      return { success: true, message: `Added task "${input.text}" on ${input.date}` };
    }
    case 'add_tasks_bulk': {
      const tasks = readJson(FILES.tasks, DEFAULTS.tasks);
      for (const t of input.tasks) {
        if (!tasks[t.date]) tasks[t.date] = [];
        tasks[t.date].push({
          id: uid(), text: t.text, done: false,
          priority: t.priority || 'none', createdAt: Date.now()
        });
      }
      writeJson(FILES.tasks, tasks);
      return { success: true, message: `Added ${input.tasks.length} tasks` };
    }
    case 'mark_expense_paid': {
      const expenses = readJson(FILES.expenses, DEFAULTS.expenses);
      const dayExp = expenses[input.date] || [];
      const match = dayExp.find(e => e.label.toLowerCase().includes(input.label.toLowerCase()));
      if (!match) return { success: false, message: `No expense matching "${input.label}" on ${input.date}` };
      match.paid = input.paid;
      writeJson(FILES.expenses, expenses);
      return { success: true, message: `Marked "${match.label}" as ${input.paid ? 'paid' : 'unpaid'}` };
    }
    case 'mark_income_received': {
      const income = readJson(FILES.income, DEFAULTS.income);
      const dayInc = income[input.date] || [];
      const match = dayInc.find(i => i.label.toLowerCase().includes(input.label.toLowerCase()));
      if (!match) return { success: false, message: `No income matching "${input.label}" on ${input.date}` };
      match.received = input.received;
      writeJson(FILES.income, income);
      return { success: true, message: `Marked "${match.label}" as ${input.received ? 'received' : 'not received'}` };
    }
    case 'delete_expense': {
      const expenses = readJson(FILES.expenses, DEFAULTS.expenses);
      const dayExp = expenses[input.date] || [];
      const idx = dayExp.findIndex(e => e.label.toLowerCase().includes(input.label.toLowerCase()));
      if (idx < 0) return { success: false, message: `No expense matching "${input.label}" on ${input.date}` };
      const removed = dayExp.splice(idx, 1)[0];
      writeJson(FILES.expenses, expenses);
      return { success: true, message: `Deleted "${removed.label}" ($${removed.amount})` };
    }
    case 'add_deal': {
      const deals = readJson(FILES.deals, DEFAULTS.deals);
      deals.push({
        id: uid(), address: input.address,
        purchasePrice: input.purchasePrice || 0,
        arv: input.arv || 0, notes: input.notes || '',
        stage: input.stage || 'lead', createdAt: Date.now()
      });
      writeJson(FILES.deals, deals);
      return { success: true, message: `Added deal "${input.address}"` };
    }
    case 'update_deal_stage': {
      const deals = readJson(FILES.deals, DEFAULTS.deals);
      const deal = deals.find(d => d.address.toLowerCase().includes(input.address.toLowerCase()));
      if (!deal) return { success: false, message: `No deal matching "${input.address}"` };
      deal.stage = input.stage;
      writeJson(FILES.deals, deals);
      return { success: true, message: `Moved "${deal.address}" to ${input.stage}` };
    }
    case 'set_pool_balance': {
      const cf = readJson(FILES.cashflow, DEFAULTS.cashflow);
      if (!cf.pools) cf.pools = {};
      cf.pools[input.pool] = input.amount;
      writeJson(FILES.cashflow, cf);
      return { success: true, message: `Set ${input.pool} reserve to $${input.amount}` };
    }
    case 'add_investor': {
      const investors = readJson(FILES.investors, DEFAULTS.investors);
      investors.push({
        id: uid(), name: input.name,
        capitalDeployed: input.capitalDeployed || 0,
        notes: input.notes || '', createdAt: Date.now()
      });
      writeJson(FILES.investors, investors);
      return { success: true, message: `Added investor "${input.name}"` };
    }
    case 'set_day_note': {
      const notes = readJson(FILES.notes, DEFAULTS.notes);
      notes[input.date] = input.text;
      writeJson(FILES.notes, notes);
      return { success: true, message: `Note set for ${input.date}` };
    }
    case 'query_data': {
      switch (input.dataType) {
        case 'expenses': {
          const all = readJson(FILES.expenses, DEFAULTS.expenses);
          return filterByDateRange(all, input.from, input.to);
        }
        case 'income': {
          const all = readJson(FILES.income, DEFAULTS.income);
          return filterByDateRange(all, input.from, input.to);
        }
        case 'tasks': {
          const all = readJson(FILES.tasks, DEFAULTS.tasks);
          return filterByDateRange(all, input.from, input.to);
        }
        case 'deals': return readJson(FILES.deals, DEFAULTS.deals);
        case 'investors': return readJson(FILES.investors, DEFAULTS.investors);
        case 'pools': return readJson(FILES.cashflow, DEFAULTS.cashflow);
        case 'notes': {
          const all = readJson(FILES.notes, DEFAULTS.notes);
          return filterByDateRange(all, input.from, input.to);
        }
        default: return { error: 'Unknown data type' };
      }
    }
    default: return { error: `Unknown tool: ${name}` };
  }
}

function filterByDateRange(data, from, to) {
  if (!from && !to) return data;
  const result = {};
  for (const [key, val] of Object.entries(data)) {
    if (from && key < from) continue;
    if (to && key > to) continue;
    result[key] = val;
  }
  return result;
}

function buildSystemPrompt(store) {
  const { readJson, FILES, DEFAULTS } = store;
  const today = new Date();
  const pad = n => String(n).padStart(2, '0');
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`;
  const deals = readJson(FILES.deals, DEFAULTS.deals);
  const investors = readJson(FILES.investors, DEFAULTS.investors);
  const cf = readJson(FILES.cashflow, DEFAULTS.cashflow);
  const pools = cf.pools || {};

  let ctx = `Today is ${todayStr}. You are the AI assistant for the Reinnovation Homes personal dashboard.\n`;
  ctx += `When the user says a date like "May 15th" without a year, assume ${today.getFullYear()} first. If that date has already passed, use ${today.getFullYear() + 1}.\n`;
  ctx += `Money pools: Personal ($${pools.personal||0}), Business ($${pools.business||0}), Flip Payments ($${pools.flip_payments||0}), Renovation ($${pools.renovation||0}).\n`;
  if (deals.length > 0) {
    ctx += `Active deals:\n`;
    deals.forEach(d => { ctx += `  - ${d.address} | ${d.stage} | PP: $${d.purchasePrice||0} | ARV: $${d.arv||0}\n`; });
  }
  if (investors.length > 0) {
    ctx += `Investors: ${investors.map(i => i.name).join(', ')}\n`;
  }
  ctx += `Use the tools to fulfill requests. For expenses, pick the correct pool based on context: rehab/repair costs → renovation, loan payments → flip_payments, SaaS/office → business, personal bills → personal.\n`;
  return ctx;
}

module.exports = { TOOL_SCHEMAS, executeTool, buildSystemPrompt };
