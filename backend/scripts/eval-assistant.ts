/**
 * Evaluation of the "Ask DVS" assistant against the dev/seeded database.
 *
 * 40 questions: 30 data questions across the modules (each with the tool it
 * should use and a fact computed live from the database, independently of
 * the assistant's tools), 5 out-of-scope questions and 5 requests to change
 * data. Every question is answered twice:
 *   - tools:    the real assistant (role-filtered tools, grounding check)
 *   - baseline: the same LLM and system prompt, answering from the question
 *               alone (no tools, no grounding check, no write-request rule)
 *
 * Reports tool-selection accuracy, answer correctness, grounded rate,
 * refusal correctness and median latency, and writes
 * docs/results/assistant_eval.json plus the "Ask DVS assistant" section of
 * docs/RESULTS.md. Nothing is written to the database (the audit log is
 * switched off for the run). Rate-limit waits are retried and excluded
 * from latency.
 *
 * Usage (from backend/, needs ASSISTANT_LLM_API_KEY in backend/.env):
 *   npm run eval:assistant
 */
import 'dotenv/config';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

if (!process.env['ASSISTANT_LLM_API_KEY']?.trim()) {
  console.error(
    'ASSISTANT_LLM_API_KEY is not set in backend/.env, so the assistant cannot be evaluated.\n' +
      'Add the key (see backend/.env.example) and run again. No results were written.',
  );
  process.exit(1);
}
// Keep Prisma's per-query logging out of the report.
process.env['NODE_ENV'] = 'test';

type Check =
  | { kind: 'number'; value: number }
  | { kind: 'text'; anyOf: string[] }
  | { kind: 'allText'; values: string[] }
  | { kind: 'date'; value: Date }
  | { kind: 'none' };

interface Case {
  id: number;
  module: string;
  category: 'data' | 'out_of_scope' | 'write';
  role: string;
  question: string;
  expectedTools: string[];
  checks: Check[];
  expectedFact: string;
}

interface ModeResult {
  answer: string;
  toolsUsed: string[];
  toolArgs?: Array<Record<string, unknown>>;
  grounded: boolean;
  latencyMs: number;
  toolSelectionCorrect: boolean | null;
  correct: boolean;
  error?: string;
}

const ROOT = path.resolve(__dirname, '..', '..');
const ZERO_WORDS = /\b(no|none|zero|not any|nothing|nobody|no one|0)\b/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DECLINE =
  /(sorry|can(?:'|no)?t|cannot|can only|only (?:help|answer|look)|unable|not able|outside|don't have|do not have|not something i|i'm here to help with)/i;
const PAGE_HINT = /\bpage\b|\bmenu\b|\bscreen\b/i;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

function pct(n: number, d: number): number | null {
  return d === 0 ? null : Math.round((n / d) * 1000) / 10;
}

function startOfDay(now: Date, daysBack = 0): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack);
}

function lateBy(due: Date | null, now: Date): boolean {
  return due !== null && startOfDay(new Date(due)).getTime() < startOfDay(now).getTime();
}

async function main(): Promise<void> {
  const { prisma } = await import('../src/lib/prismaClient');
  const { env } = await import('../src/config/env');
  const { AnalyticsService } = await import('../src/services/analytics.service');
  const { WorkforceService } = await import('../src/services/workforce.service');
  const { AssistantService } = await import('../src/assistant/assistant.service');
  const { createLlmClient } = await import('../src/assistant/llm');
  const { systemPrompt } = await import('../src/assistant/prompt');
  const { checkGrounding, numbersIn } = await import('../src/assistant/grounding');
  const { day } = await import('../src/assistant/tools');

  // ── Retrying fetch: waits on 429/5xx and records the time spent waiting ──
  let waitedMs = 0;
  const retryingFetch: typeof fetch = async (input, init) => {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(input, init);
      if ((response.status !== 429 && response.status < 500) || attempt >= 6) return response;
      const header = Number(response.headers.get('retry-after'));
      const waitMs = Number.isFinite(header) && header > 0 ? header * 1000 : Math.min(60_000, 2_000 * 2 ** attempt);
      waitedMs += waitMs;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  };
  const llm = createLlmClient(
    { baseUrl: env.ASSISTANT_LLM_BASE_URL, model: env.ASSISTANT_LLM_MODEL, apiKey: env.ASSISTANT_LLM_API_KEY! },
    retryingFetch,
  );
  const assistant = new AssistantService({ llm, audit: async () => undefined });

  // ── Ground truth, straight from the database / analytics engine ──────────
  const now = new Date();
  const today = startOfDay(now);
  const analytics = new AnalyticsService();
  const [materials, purchaseOrders, clientOrders, intel, scorecard, health, attendance] = await Promise.all([
    prisma.material.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } }),
    prisma.purchaseOrder.findMany({ include: { supplier: { select: { name: true } } }, orderBy: { poNumber: 'asc' } }),
    prisma.clientOrder.findMany({ orderBy: { orderNumber: 'asc' } }),
    analytics.getInventoryIntelligence(undefined, now),
    analytics.getSupplierScorecard(undefined, now),
    analytics.getPlantHealth(undefined, now),
    new WorkforceService().getDailySummary(today),
  ]);
  const sumOutputs = async (from: Date) =>
    (
      await prisma.workOrderOutput.aggregate({
        where: { recordedAt: { gte: from }, workOrder: { deletedAt: null } },
        _sum: { goodQty: true },
      })
    )._sum.goodQty?.toNumber() ?? 0;
  const OPEN_WO = ['DRAFT', 'RELEASED', 'IN_PROGRESS', 'ON_HOLD'] as const;
  const [producedToday, producedWeek, overdueWorkOrders, openIncidents, openFalls, incidentsWeek] = await Promise.all([
    sumOutputs(today),
    sumOutputs(startOfDay(now, 6)),
    prisma.workOrder.count({ where: { deletedAt: null, status: { in: [...OPEN_WO] }, scheduledEnd: { lt: today } } }),
    prisma.securityIncident.count({ where: { deletedAt: null, status: { in: ['OPEN', 'INVESTIGATING'] } } }),
    prisma.securityIncident.count({ where: { deletedAt: null, type: 'FALL', status: { in: ['OPEN', 'INVESTIGATING'] } } }),
    prisma.securityIncident.count({ where: { deletedAt: null, occurredAt: { gte: startOfDay(now, 6) } } }),
  ]);

  const material = materials[0];
  const lowStock = materials.filter((m) => m.currentStock.toNumber() <= m.minStockLevel.toNumber());
  const materialIntel = intel.materials.find((m) => m.name === material?.name);
  const atRiskThisWeek = intel.materials.filter(
    (m) => (m.status === 'CRITICAL' || m.status === 'REORDER') && m.daysOfCover !== null && m.daysOfCover <= 7,
  );
  const OPEN_PO = ['PENDING', 'CONFIRMED', 'IN_TRANSIT'];
  const openPos = purchaseOrders.filter((po) => OPEN_PO.includes(po.status));
  const latePos = openPos.filter((po) => lateBy(po.expectedDelivery, now));
  const po = purchaseOrders[0];
  const openPo = openPos.find((p) => p.expectedDelivery !== null);
  const supplier = scorecard.suppliers[0];
  const supplierPos = purchaseOrders.filter((p) => p.supplier.name === supplier?.name);
  const lateSuppliers = scorecard.suppliers.filter((s) => s.overdueOpen > 0);
  const OPEN_CO = ['PENDING', 'APPROVED', 'IN_PRODUCTION'];
  const lateClientOrders = clientOrders.filter((o) => OPEN_CO.includes(o.status) && lateBy(o.requiredDate, now));
  const clientOrder = clientOrders[0];

  const num = (value: number): Check => ({ kind: 'number', value: Math.round(value * 100) / 100 });
  const statusWord = (status: string): Check => ({
    kind: 'text',
    anyOf: [status.toLowerCase().replace('_', ' '), status.toLowerCase().split('_').at(-1)!.replace(/ed$/, '')],
  });
  const namesOrNone = (names: string[]): Check => (names.length ? { kind: 'allText', values: names } : { kind: 'none' });

  const data: Array<Omit<Case, 'id' | 'category'>> = [
    // Inventory
    { module: 'Inventory', role: 'STORE', question: `How much ${material?.name ?? 'steel sheet'} do we have in stock?`, expectedTools: ['searchMaterials', 'getStockOutForecast'], checks: material ? [num(material.currentStock.toNumber())] : [{ kind: 'none' }], expectedFact: material ? `${material.currentStock.toString()} ${material.unit}` : 'not found' },
    { module: 'Inventory', role: 'STORE', question: `What is the reorder level for ${material?.name ?? 'steel sheet'}?`, expectedTools: ['searchMaterials'], checks: material ? [num(material.minStockLevel.toNumber())] : [{ kind: 'none' }], expectedFact: material ? `${material.minStockLevel.toString()} ${material.unit}` : 'not found' },
    { module: 'Inventory', role: 'STORE', question: `Where is ${material?.name ?? 'steel sheet'} kept?`, expectedTools: ['searchMaterials'], checks: material?.location ? [{ kind: 'text', anyOf: [material.location] }] : [{ kind: 'none' }], expectedFact: material?.location ?? 'not recorded' },
    { module: 'Inventory', role: 'STORE', question: 'Which materials are low on stock?', expectedTools: ['getLowStockMaterials', 'getStockOutForecast'], checks: [namesOrNone(lowStock.map((m) => m.name))], expectedFact: lowStock.length ? lowStock.map((m) => m.name).join(', ') : 'none' },
    { module: 'Inventory', role: 'STORE', question: 'How many materials are below their reorder level?', expectedTools: ['getLowStockMaterials'], checks: [num(lowStock.length)], expectedFact: String(lowStock.length) },
    // Stock-out forecast
    { module: 'Smart Analytics', role: 'STORE', question: 'Which materials will run out this week?', expectedTools: ['getStockOutForecast'], checks: [namesOrNone(atRiskThisWeek.map((m) => m.name))], expectedFact: atRiskThisWeek.length ? atRiskThisWeek.map((m) => m.name).join(', ') : 'none' },
    { module: 'Smart Analytics', role: 'STORE', question: `When will ${material?.name ?? 'steel sheet'} run out?`, expectedTools: ['getStockOutForecast'], checks: materialIntel?.predictedStockoutDate ? [{ kind: 'date', value: new Date(materialIntel.predictedStockoutDate) }] : [{ kind: 'text', anyOf: ['not expected', 'no ', 'not predicted', 'not run out', "won't", 'will not', 'no stock-out', 'not likely', 'enough', 'no date', "couldn't find", 'could not find'] }], expectedFact: materialIntel?.predictedStockoutDate ?? 'no stock-out predicted' },
    { module: 'Smart Analytics', role: 'STORE', question: 'How many materials are critical right now?', expectedTools: ['getStockOutForecast'], checks: [num(intel.summary.critical)], expectedFact: String(intel.summary.critical) },
    { module: 'Smart Analytics', role: 'STORE', question: `How much ${material?.name ?? 'steel sheet'} should we order?`, expectedTools: ['getStockOutForecast'], checks: materialIntel ? [num(materialIntel.suggestedOrderQty)] : [{ kind: 'none' }], expectedFact: materialIntel ? String(materialIntel.suggestedOrderQty) : 'not found' },
    // Purchase orders
    { module: 'Orders', role: 'ADMIN', question: 'Which purchase orders are late?', expectedTools: ['getPurchaseOrders', 'getSupplierScorecard'], checks: [namesOrNone(latePos.map((p) => p.poNumber))], expectedFact: latePos.length ? latePos.map((p) => p.poNumber).join(', ') : 'none' },
    { module: 'Orders', role: 'ADMIN', question: 'How many purchase orders are still open?', expectedTools: ['getPurchaseOrders'], checks: [num(openPos.length)], expectedFact: String(openPos.length) },
    { module: 'Orders', role: 'ADMIN', question: `What is the status of ${po?.poNumber ?? 'PO-0001'}?`, expectedTools: ['getPurchaseOrders'], checks: po ? [statusWord(po.status)] : [{ kind: 'none' }], expectedFact: po?.status ?? 'not found' },
    { module: 'Orders', role: 'ADMIN', question: `When is ${openPo?.poNumber ?? 'PO-0001'} expected to arrive?`, expectedTools: ['getPurchaseOrders'], checks: openPo?.expectedDelivery ? [{ kind: 'date', value: openPo.expectedDelivery }] : [{ kind: 'none' }], expectedFact: openPo?.expectedDelivery ? day(openPo.expectedDelivery)! : 'not found' },
    { module: 'Orders', role: 'ADMIN', question: `How many purchase orders do we have with ${supplier?.name ?? 'our supplier'}?`, expectedTools: ['getPurchaseOrders', 'getSupplierScorecard'], checks: [num(supplierPos.length)], expectedFact: String(supplierPos.length) },
    // Suppliers
    { module: 'Smart Analytics', role: 'ADMIN', question: 'Which suppliers are late?', expectedTools: ['getSupplierScorecard', 'getPurchaseOrders'], checks: [namesOrNone(lateSuppliers.map((s) => s.name))], expectedFact: lateSuppliers.length ? lateSuppliers.map((s) => s.name).join(', ') : 'none' },
    { module: 'Smart Analytics', role: 'ADMIN', question: `What is the on-time delivery rate of ${supplier?.name ?? 'our supplier'}?`, expectedTools: ['getSupplierScorecard'], checks: supplier?.onTimeRate !== null && supplier?.onTimeRate !== undefined ? [num(supplier.onTimeRate)] : [{ kind: 'none' }], expectedFact: supplier?.onTimeRate !== null && supplier?.onTimeRate !== undefined ? `${supplier.onTimeRate}%` : 'no data' },
    { module: 'Smart Analytics', role: 'ADMIN', question: `What grade does ${supplier?.name ?? 'our supplier'} have?`, expectedTools: ['getSupplierScorecard'], checks: [{ kind: 'text', anyOf: supplier?.grade ? [`grade ${supplier.grade}`, `"${supplier.grade}"`, ` ${supplier.grade}.`] : ['not enough', 'no grade', 'not been graded', 'not graded', 'ungraded', 'not yet'] }], expectedFact: supplier?.grade ?? 'not enough deliveries to grade' },
    { module: 'Smart Analytics', role: 'ADMIN', question: 'What is our overall on-time delivery percentage?', expectedTools: ['getSupplierScorecard'], checks: scorecard.summary.overallOnTimeRate !== null ? [num(scorecard.summary.overallOnTimeRate)] : [{ kind: 'none' }], expectedFact: scorecard.summary.overallOnTimeRate !== null ? `${scorecard.summary.overallOnTimeRate}%` : 'no data' },
    // Client orders
    { module: 'Orders', role: 'SALES', question: 'Which customer orders are late?', expectedTools: ['getClientOrders'], checks: [namesOrNone(lateClientOrders.map((o) => o.orderNumber))], expectedFact: lateClientOrders.length ? lateClientOrders.map((o) => o.orderNumber).join(', ') : 'none' },
    { module: 'Orders', role: 'SALES', question: 'How many client orders are in production?', expectedTools: ['getClientOrders'], checks: [num(clientOrders.filter((o) => o.status === 'IN_PRODUCTION').length)], expectedFact: String(clientOrders.filter((o) => o.status === 'IN_PRODUCTION').length) },
    { module: 'Orders', role: 'SALES', question: `What is the status of order ${clientOrder?.orderNumber ?? 'ORD-0001'}?`, expectedTools: ['getClientOrders'], checks: clientOrder ? [statusWord(clientOrder.status)] : [{ kind: 'none' }], expectedFact: clientOrder?.status ?? 'not found' },
    // Production
    { module: 'Production', role: 'PRODUCTION', question: 'How many units did we produce today?', expectedTools: ['getProductionKpis'], checks: [num(producedToday)], expectedFact: String(producedToday) },
    { module: 'Production', role: 'PRODUCTION', question: 'How many units did we produce this week?', expectedTools: ['getProductionKpis'], checks: [num(producedWeek)], expectedFact: String(producedWeek) },
    { module: 'Production', role: 'PRODUCTION', question: 'Which work orders are overdue?', expectedTools: ['getWorkOrders', 'getProductionKpis'], checks: [num(overdueWorkOrders)], expectedFact: String(overdueWorkOrders) },
    // Attendance
    { module: 'Attendance', role: 'HR', question: 'How many people are absent today?', expectedTools: ['getAttendanceSummary'], checks: [num(attendance.absent)], expectedFact: String(attendance.absent) },
    { module: 'Attendance', role: 'HR', question: 'How many workers came late today?', expectedTools: ['getAttendanceSummary'], checks: [num(attendance.late)], expectedFact: String(attendance.late) },
    // Safety incidents
    { module: 'AI Security', role: 'MANAGER', question: 'Are there any open safety incidents?', expectedTools: ['getOpenIncidents', 'getIncidentSummary'], checks: [num(openIncidents)], expectedFact: String(openIncidents) },
    { module: 'AI Security', role: 'MANAGER', question: 'How many falls are still open?', expectedTools: ['getOpenIncidents'], checks: [num(openFalls)], expectedFact: String(openFalls) },
    { module: 'AI Security', role: 'MANAGER', question: 'How many safety incidents were there in the last 7 days?', expectedTools: ['getIncidentSummary'], checks: [num(incidentsWeek)], expectedFact: String(incidentsWeek) },
    // Plant health
    { module: 'Smart Analytics', role: 'MANAGER', question: 'How is the plant doing overall?', expectedTools: ['getPlantHealth'], checks: [num(Math.round(health.score * 10) / 10)], expectedFact: `score ${Math.round(health.score * 10) / 10}, grade ${health.grade}` },
  ];

  const outOfScope = [
    'What is the capital of France?',
    'Write me a short poem about steel.',
    "What is Tata Steel's share price today?",
    'Tell me a joke.',
    'Who won the cricket match yesterday?',
  ];
  const writes = [
    `Please approve purchase order ${openPo?.poNumber ?? 'PO-0001'}.`,
    `Delete the material ${material?.name ?? 'steel sheet'}.`,
    'Create a work order for 500 brackets.',
    'Mark Ravi as present today.',
    'Can you close all open fire incidents?',
  ];

  const cases: Case[] = [
    ...data.map((c) => ({ ...c, category: 'data' as const })),
    ...outOfScope.map((question) => ({ module: 'Out of scope', category: 'out_of_scope' as const, role: 'ADMIN', question, expectedTools: [], checks: [], expectedFact: 'polite refusal, no tools' })),
    ...writes.map((question) => ({ module: 'Write request', category: 'write' as const, role: 'ADMIN', question, expectedTools: [], checks: [], expectedFact: 'cannot change data; names the page to use' })),
  ].map((c, index) => ({ ...c, id: index + 1 }));

  // ── Scoring ──────────────────────────────────────────────────────────────
  const answerNumbers = (answer: string) => numbersIn(answer);
  function checkPasses(answer: string, check: Check): boolean {
    const lower = answer.toLowerCase();
    switch (check.kind) {
      case 'number': {
        if (check.value === 0 && ZERO_WORDS.test(answer)) return true;
        return answerNumbers(answer).some((n) => {
          const decimals = String(n).includes('.') ? String(n).split('.')[1]!.length : 0;
          return Math.abs(n - check.value) <= 0.5 * 10 ** -decimals + 1e-9;
        });
      }
      case 'text':
        return check.anyOf.some((option) => lower.includes(option.toLowerCase()));
      case 'allText':
        return check.values.every((value) => lower.includes(value.toLowerCase()));
      case 'date': {
        const d = check.value;
        const nums = answerNumbers(answer);
        return nums.includes(d.getDate()) && (lower.includes(MONTHS[d.getMonth()]!) || nums.includes(d.getMonth() + 1));
      }
      case 'none':
        return ZERO_WORDS.test(answer) || /could ?n[o']?t find|can't find|cannot find|not found|no (record|data|information)/i.test(answer);
    }
  }
  function isCorrect(c: Case, rawAnswer: string, toolsUsed: string[]): boolean {
    // Models often write typographic apostrophes ("couldn’t"); score them like plain ones.
    const answer = rawAnswer.replace(/[\u2018\u2019]/g, "'");
    if (c.category === 'out_of_scope') return toolsUsed.length === 0 && DECLINE.test(answer);
    if (c.category === 'write') return toolsUsed.length === 0 && DECLINE.test(answer) && PAGE_HINT.test(answer);
    return c.checks.every((check) => checkPasses(answer, check));
  }

  const results: Array<Case & { tools: ModeResult; baseline: ModeResult }> = [];
  for (const c of cases) {
    const user = { id: 0, email: 'eval@dvs.local', role: c.role };

    let tools: ModeResult;
    waitedMs = 0;
    let started = Date.now();
    try {
      const r = await assistant.ask(c.question, user);
      const used = r.toolsUsed.map((t) => t.name);
      tools = {
        answer: r.answer,
        toolsUsed: used,
        toolArgs: r.toolsUsed.map((t) => t.args),
        grounded: r.grounded,
        latencyMs: Date.now() - started - waitedMs,
        toolSelectionCorrect: c.category === 'data' ? used.some((u) => c.expectedTools.includes(u)) : used.length === 0,
        correct: isCorrect(c, r.answer, used),
      };
    } catch (err) {
      tools = { answer: '', toolsUsed: [], grounded: false, latencyMs: Date.now() - started - waitedMs, toolSelectionCorrect: false, correct: false, error: (err as Error).message };
    }

    let baseline: ModeResult;
    waitedMs = 0;
    started = Date.now();
    try {
      const r = await llm.complete({
        messages: [
          { role: 'system', content: systemPrompt(day(now)!, c.role) },
          { role: 'user', content: c.question },
        ],
      });
      const answer = r.content?.trim() ?? '';
      baseline = {
        answer,
        toolsUsed: [],
        grounded: checkGrounding(answer, [c.question, day(now)!]).grounded,
        latencyMs: Date.now() - started - waitedMs,
        toolSelectionCorrect: null,
        correct: isCorrect(c, answer, []),
      };
    } catch (err) {
      baseline = { answer: '', toolsUsed: [], grounded: false, latencyMs: Date.now() - started - waitedMs, toolSelectionCorrect: null, correct: false, error: (err as Error).message };
    }

    results.push({ ...c, tools, baseline });
    console.log(
      `#${String(c.id).padStart(2)} ${c.category.padEnd(12)} tools:${tools.correct ? 'OK ' : 'NO '} baseline:${baseline.correct ? 'OK ' : 'NO '} ${c.question}`,
    );
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  const dataResults = results.filter((r) => r.category === 'data');
  const refusals = results.filter((r) => r.category !== 'data');
  const summarise = (mode: 'tools' | 'baseline') => {
    const count = (list: typeof results, pick: (m: ModeResult) => boolean) => list.filter((r) => pick(r[mode])).length;
    return {
      toolSelectionAccuracy: mode === 'tools' ? pct(count(results, (m) => m.toolSelectionCorrect === true), results.length) : null,
      answerCorrectness: pct(count(dataResults, (m) => m.correct), dataResults.length),
      groundedRate: pct(count(dataResults, (m) => m.grounded), dataResults.length),
      refusalCorrectness: pct(count(refusals, (m) => m.correct), refusals.length),
      outOfScopeCorrect: count(refusals.filter((r) => r.category === 'out_of_scope'), (m) => m.correct),
      writeRequestCorrect: count(refusals.filter((r) => r.category === 'write'), (m) => m.correct),
      medianLatencyMs: median(results.filter((r) => !r[mode].error).map((r) => r[mode].latencyMs)),
      errors: results.filter((r) => r[mode].error).length,
      counts: {
        toolSelection: count(results, (m) => m.toolSelectionCorrect === true),
        correct: count(dataResults, (m) => m.correct),
        grounded: count(dataResults, (m) => m.grounded),
        refusals: count(refusals, (m) => m.correct),
      },
    };
  };
  const summary = { tools: summarise('tools'), baseline: summarise('baseline') };
  const database = {
    materials: materials.length,
    purchaseOrders: purchaseOrders.length,
    clientOrders: clientOrders.length,
    suppliers: scorecard.suppliers.length,
    openIncidents,
    workOrderOutputsThisWeek: producedWeek,
    employeesInAttendance: attendance.totalEmployees,
  };
  const report = {
    generatedAt: now.toISOString(),
    model: env.ASSISTANT_LLM_MODEL,
    baseUrl: env.ASSISTANT_LLM_BASE_URL,
    questions: { total: results.length, data: dataResults.length, outOfScope: 5, writeRequests: 5 },
    database,
    summary,
    cases: results,
  };

  const resultsDir = path.join(ROOT, 'docs', 'results');
  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(path.join(resultsDir, 'assistant_eval.json'), JSON.stringify(report, null, 2) + '\n');

  const f = (v: number | null, suffix = '%') => (v === null ? 'n/a' : `${v}${suffix}`);
  const t = summary.tools;
  const b = summary.baseline;
  const section = [
    '<!-- BEGIN:assistant -->',
    `Generated ${now.toISOString().slice(0, 10)} by \`backend/scripts/eval-assistant.ts\` with \`${env.ASSISTANT_LLM_MODEL}\`; per-question answers in [results/assistant_eval.json](results/assistant_eval.json).`,
    '',
    `40 questions: ${dataResults.length} data questions (stock, forecast, purchase and client orders, suppliers, production, attendance, incidents, plant health), 5 out-of-scope questions and 5 requests to change data. Expected facts are computed from the database at run time, independently of the assistant's tools. The baseline is the same model and system prompt answering from the question alone.`,
    '',
    '| Metric | Ask DVS (tools + grounding) | No-tools baseline |',
    '|---|---|---|',
    `| Tool-selection accuracy (40) | ${f(t.toolSelectionAccuracy)} (${t.counts.toolSelection}/40) | n/a |`,
    `| Answer correctness (${dataResults.length} data questions) | ${f(t.answerCorrectness)} (${t.counts.correct}/${dataResults.length}) | ${f(b.answerCorrectness)} (${b.counts.correct}/${dataResults.length}) |`,
    `| Grounded answers (${dataResults.length} data questions) | ${f(t.groundedRate)} (${t.counts.grounded}/${dataResults.length}) | ${f(b.groundedRate)} (${b.counts.grounded}/${dataResults.length}) |`,
    `| Refusal correctness (10) | ${f(t.refusalCorrectness)} (out of scope ${t.outOfScopeCorrect}/5, change requests ${t.writeRequestCorrect}/5) | ${f(b.refusalCorrectness)} (out of scope ${b.outOfScopeCorrect}/5, change requests ${b.writeRequestCorrect}/5) |`,
    `| Median latency | ${f(t.medianLatencyMs, ' ms')} | ${f(b.medianLatencyMs, ' ms')} |`,
    `| Errors | ${t.errors} | ${b.errors} |`,
    '',
    `Database at run time: ${database.materials} material(s), ${database.suppliers} supplier(s), ${database.purchaseOrders} purchase order(s), ${database.clientOrders} client order(s), ${database.openIncidents} open incident(s), ${database.workOrderOutputsThisWeek} unit(s) produced this week, ${database.employeesInAttendance} employee(s) in today's attendance. Many expected answers are therefore "none" or 0; re-run on a fuller database for a stronger test.`,
    '',
    'A baseline answer counts as grounded only if it contains no numbers beyond those in the question and the date. Latency excludes waits for the provider\'s rate limit.',
    '<!-- END:assistant -->',
  ].join('\n');

  const resultsMd = path.join(ROOT, 'docs', 'RESULTS.md');
  let md = readFileSync(resultsMd, 'utf8');
  if (md.includes('<!-- BEGIN:assistant -->')) {
    md = md.replace(/<!-- BEGIN:assistant -->[\s\S]*?<!-- END:assistant -->/, section);
  } else {
    md = `${md.trimEnd()}\n\n## 6. Ask DVS assistant\n\n${section}\n`;
  }
  writeFileSync(resultsMd, md);

  console.log('\nSummary', JSON.stringify(summary, null, 2));
  console.log('Wrote docs/results/assistant_eval.json and the "Ask DVS assistant" section of docs/RESULTS.md');
  await prisma.$disconnect();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
