/**
 * Ask DVS service with the LLM mocked: role-filtered tools, grounding check,
 * write requests, tool-round limit and auditing.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/env', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'silent', PERCEPTION_OUTPUT_DIR: 'output' },
}));
vi.mock('../../lib/prismaClient', () => ({ prisma: {} }));
vi.mock('../../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { AppError } from '../../errors';
import {
  AssistantService,
  MAX_TOOL_ROUNDS,
  type AuditEntry,
} from '../../assistant/assistant.service';
import {
  createLlmClient,
  InvalidToolCallError,
  type CompletionRequest,
  type CompletionResult,
  type LlmClient,
} from '../../assistant/llm';
import { NO_RELIABLE_ANSWER, writeRequestReply } from '../../assistant/prompt';
import { checkGrounding, numbersIn } from '../../assistant/grounding';
import type { ToolRun, AssistantUser } from '../../assistant/tools';
import { executeTool } from '../../assistant/tools';

const STORE: AssistantUser = { id: 3, email: 'store@test.com', role: 'STORE' };
const ADMIN: AssistantUser = { id: 1, email: 'admin@test.com', role: 'ADMIN' };
const NOW = new Date(2026, 9, 17, 11, 0);

function toolCall(name: string, args: Record<string, unknown> = {}, id = 'call-1') {
  return { id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } };
}

/** An LLM that plays back scripted replies and records every request. */
function scriptedLlm(replies: CompletionResult[]) {
  const requests: CompletionRequest[] = [];
  const llm: LlmClient = {
    complete: vi.fn(async (request: CompletionRequest) => {
      requests.push(structuredClone(request));
      const next = replies.shift();
      if (next === undefined) throw new Error('LLM called more often than scripted');
      return next;
    }),
  };
  return { llm, requests };
}

const text = (content: string): CompletionResult => ({ content, toolCalls: [] });

function fakeExecute(results: Record<string, unknown>): typeof executeTool {
  return vi.fn(async (name: string, args: unknown): Promise<ToolRun> => {
    if (!(name in results)) throw new Error(`unexpected tool ${name}`);
    return {
      name,
      args: args as Record<string, unknown>,
      module: name.includes('Incident') ? 'AI Security' : 'Inventory',
      result: results[name],
    };
  });
}

function service(llm: LlmClient | null, execute?: typeof executeTool) {
  const audits: AuditEntry[] = [];
  const svc = new AssistantService({
    llm,
    execute: execute ?? fakeExecute({}),
    audit: async (entry) => {
      audits.push(entry);
    },
    now: () => NOW,
  });
  return { svc, audits };
}

const LOW_STOCK = {
  lowStockCount: 2,
  materials: [
    { name: 'MS Sheet 2mm', currentStock: 120.5, unit: 'kg', reorderLevel: 200 },
    { name: 'Hex Bolt M10', currentStock: 40, unit: 'pcs', reorderLevel: 150 },
  ],
};

describe('AssistantService.ask', () => {
  it('offers a store user no incident tools', async () => {
    const { llm, requests } = scriptedLlm([text('I could not find that information.')]);
    await service(llm).svc.ask('Any open safety incidents?', STORE);

    const offered = requests[0]!.tools!.map((t) => t.function.name);
    expect(offered).not.toContain('getOpenIncidents');
    expect(offered).not.toContain('getIncidentSummary');
    expect(offered).toContain('getLowStockMaterials');
  });

  it('rejects a forbidden tool the LLM asks for and tells it so', async () => {
    const { llm, requests } = scriptedLlm([
      { content: null, toolCalls: [toolCall('getOpenIncidents')] },
      text('That information is not available for your role.'),
    ]);
    const result = await service(llm, executeTool).svc.ask('Any open safety incidents?', STORE);

    const toolMessage = requests[1]!.messages.find((m) => m.role === 'tool');
    expect(toolMessage?.content).toContain('not available for your role');
    expect(result.toolsUsed).toEqual([]);
    expect(result.grounded).toBe(true);
  });

  it('returns a grounded answer with the tools and sources used', async () => {
    const { llm } = scriptedLlm([
      { content: null, toolCalls: [toolCall('getLowStockMaterials')] },
      text('2 materials are low: MS Sheet 2mm has 120.5 kg and Hex Bolt M10 has 40 pcs.'),
    ]);
    const { svc, audits } = service(llm, fakeExecute({ getLowStockMaterials: LOW_STOCK }));
    const result = await svc.ask('Which materials are low on stock?', STORE);

    expect(result).toEqual({
      answer: '2 materials are low: MS Sheet 2mm has 120.5 kg and Hex Bolt M10 has 40 pcs.',
      toolsUsed: [{ name: 'getLowStockMaterials', args: {} }],
      sources: ['Inventory'],
      grounded: true,
    });
    expect(audits).toEqual([
      expect.objectContaining({
        user: STORE,
        question: 'Which materials are low on stock?',
        toolsUsed: ['getLowStockMaterials'],
        grounded: true,
        outcome: 'answered',
        durationMs: expect.any(Number),
      }),
    ]);
  });

  it('replaces non-breaking hyphens so order numbers can be copied', async () => {
    const { llm } = scriptedLlm([
      { content: null, toolCalls: [toolCall('getLowStockMaterials')] },
      text('PO‑TEST‑002 is 2 days late.'),
    ]);
    const result = await service(llm, fakeExecute({ getLowStockMaterials: LOW_STOCK })).svc.ask(
      'Which purchase orders are late?',
      STORE,
    );
    expect(result.answer).toBe('PO-TEST-002 is 2 days late.');
  });

  it('rejects an answer with a number that is not in the tool results', async () => {
    const { llm, requests } = scriptedLlm([
      { content: null, toolCalls: [toolCall('getLowStockMaterials')] },
      text('MS Sheet 2mm has 950 kg left.'),
      text('MS Sheet 2mm has about 900 kg.'),
    ]);
    const result = await service(llm, fakeExecute({ getLowStockMaterials: LOW_STOCK })).svc.ask(
      'How much MS sheet do we have?',
      STORE,
    );

    expect(result.answer).toBe(NO_RELIABLE_ANSWER);
    expect(result.grounded).toBe(false);
    expect(result.answer).not.toMatch(/9\d\d/);
    // The retry asked for tool-result numbers only, with tools switched off.
    expect(requests[2]!.messages.at(-1)).toMatchObject({
      role: 'user',
      content: expect.stringContaining('only numbers'),
    });
    expect(requests[2]!.toolChoice).toBe('none');
  });

  it('accepts the retried answer once it uses only tool-result numbers', async () => {
    const { llm } = scriptedLlm([
      { content: null, toolCalls: [toolCall('getLowStockMaterials')] },
      text('MS Sheet 2mm has 950 kg left.'),
      text('MS Sheet 2mm has 120.5 kg left, below its reorder level of 200 kg.'),
    ]);
    const result = await service(llm, fakeExecute({ getLowStockMaterials: LOW_STOCK })).svc.ask(
      'How much MS sheet do we have?',
      STORE,
    );
    expect(result.grounded).toBe(true);
    expect(result.answer).toContain('120.5 kg');
  });

  it('answers write requests with the page to use, without calling the LLM', async () => {
    const { llm } = scriptedLlm([]);
    const { svc, audits } = service(llm);
    const result = await svc.ask('Please approve purchase order PO-0012', ADMIN);

    expect(result).toEqual({
      answer:
        "I can only look things up, I can't make changes. Please use the Orders & Supply page to do that.",
      toolsUsed: [],
      sources: [],
      grounded: true,
    });
    expect(llm.complete).not.toHaveBeenCalled();
    expect(audits[0]).toMatchObject({ outcome: 'write_request' });
  });

  it(`stops after ${MAX_TOOL_ROUNDS} tool rounds and forces a text answer`, async () => {
    const loop = { content: null, toolCalls: [toolCall('getLowStockMaterials')] };
    const { llm, requests } = scriptedLlm([
      loop,
      loop,
      loop,
      text('2 materials are low on stock.'),
    ]);
    const execute = fakeExecute({ getLowStockMaterials: LOW_STOCK });
    const result = await service(llm, execute).svc.ask('Which materials are low?', STORE);

    expect(execute).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS);
    expect(requests).toHaveLength(MAX_TOOL_ROUNDS + 1);
    expect(requests.slice(0, MAX_TOOL_ROUNDS).every((r) => r.toolChoice === 'auto')).toBe(true);
    expect(requests[MAX_TOOL_ROUNDS]!.toolChoice).toBe('none');
    expect(result.answer).toBe('2 materials are low on stock.');
  });

  it('tells the model why its tool call was rejected and lets it try again once', async () => {
    const requests: CompletionRequest[] = [];
    let calls = 0;
    const llm: LlmClient = {
      complete: vi.fn(async (request: CompletionRequest) => {
        requests.push(structuredClone(request));
        calls += 1;
        if (calls === 1)
          throw new InvalidToolCallError('`/type`: value must be one of fight, fall');
        if (calls === 2) return { content: null, toolCalls: [toolCall('getOpenIncidents')] };
        return text('There are 2 open incidents.');
      }),
    };
    const { svc } = service(
      llm,
      fakeExecute({ getOpenIncidents: { openCount: 2, incidents: [] } }),
    );

    const result = await svc.ask('How many security incidents are open?', ADMIN);

    expect(result.answer).toBe('There are 2 open incidents.');
    expect(result.grounded).toBe(true);
    const correction = requests[1]!.messages.at(-1)!;
    expect(correction.role).toBe('user');
    expect('content' in correction && correction.content).toContain(
      'value must be one of fight, fall',
    );
  });

  it('gives up when the corrected tool call is rejected too', async () => {
    const llm: LlmClient = {
      complete: vi.fn(async () => {
        throw new InvalidToolCallError('`/type`: value must be one of fight, fall');
      }),
    };
    const { svc, audits } = service(llm);

    await expect(svc.ask('How many security incidents are open?', ADMIN)).rejects.toMatchObject({
      code: 'ASSISTANT_UNAVAILABLE',
    });
    expect(llm.complete).toHaveBeenCalledTimes(2);
    expect(audits.at(-1)!.outcome).toBe('error');
  });

  it('throws 503 with a clear message when no API key is configured', async () => {
    const { svc } = service(null);
    const error = await svc.ask('Which materials are low?', STORE).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ statusCode: 503, code: 'ASSISTANT_NOT_CONFIGURED' });
    expect((error as Error).message).toMatch(/Assistant not configured/);
  });
});

describe('writeRequestReply', () => {
  it('recognises instructions to change data and names the page', () => {
    expect(writeRequestReply('Delete the material Hex Bolt M10')).toContain('Inventory page');
    expect(writeRequestReply('can you mark attendance for Ravi')).toContain('Attendance');
    expect(writeRequestReply('I want to close the fire incident')).toContain('AI Security page');
    expect(writeRequestReply('Create a work order for 500 brackets')).toContain('Production page');
  });

  it('leaves questions alone', () => {
    expect(writeRequestReply('Which purchase orders are late?')).toBeNull();
    expect(writeRequestReply('Order status for PO-0012?')).toBeNull();
    expect(writeRequestReply('How many units did we produce today?')).toBeNull();
  });
});

describe('checkGrounding', () => {
  const evidence = [
    JSON.stringify({ stock: 1250.5, onTimePercent: 87.4, date: '2026-10-17', share: 0.875 }),
  ];

  it('accepts thousands separators, rounding, percentages and dates', () => {
    expect(
      checkGrounding('We have 1,250.5 kg; on time 87% (87.4%) since 17 Oct 2026.', evidence)
        .grounded,
    ).toBe(true);
    expect(checkGrounding('87.5% of orders were complete.', evidence).grounded).toBe(true);
  });

  it('reports numbers that no tool result supports', () => {
    expect(checkGrounding('We have 1,300 kg.', evidence)).toEqual({
      grounded: false,
      unsupported: [1300],
    });
  });

  it('reads numbers the way people write them', () => {
    expect(numbersIn('1,25,000 units, PO-0012 and 3.5 kg')).toEqual([125000, 12, 3.5]);
  });
});

describe('createLlmClient', () => {
  const reply = { choices: [{ message: { content: 'There are 2.' } }] };
  const ok = () => new Response(JSON.stringify(reply), { status: 200 });
  const limited = (retryAfter: string) =>
    new Response('{}', { status: 429, headers: { 'retry-after': retryAfter } });

  it('waits once for a short rate-limit pause, then answers', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockResolvedValueOnce(limited('1')).mockResolvedValueOnce(ok());
    const client = createLlmClient(
      { baseUrl: 'https://llm.test/v1', model: 'm', apiKey: 'k' },
      fetchImpl,
    );
    const pending = client.complete({ messages: [{ role: 'user', content: 'hi' }] });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toEqual({ content: 'There are 2.', toolCalls: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('reports a rejected tool call with the provider explanation', async () => {
    const rejected = new Response(
      JSON.stringify({
        error: { code: 'tool_use_failed', message: '`/type`: value must be one of fight, fall' },
      }),
      { status: 400 },
    );
    const client = createLlmClient(
      { baseUrl: 'https://llm.test/v1', model: 'm', apiKey: 'k' },
      vi.fn().mockResolvedValue(rejected),
    );
    const error = await client
      .complete({ messages: [{ role: 'user', content: 'hi' }] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidToolCallError);
    expect((error as InvalidToolCallError).detail).toContain('value must be one of fight, fall');
  });

  it('treats any other 400 as "unavailable"', async () => {
    const bad = new Response(JSON.stringify({ error: { code: 'invalid_request' } }), {
      status: 400,
    });
    const client = createLlmClient(
      { baseUrl: 'https://llm.test/v1', model: 'm', apiKey: 'k' },
      vi.fn().mockResolvedValue(bad),
    );
    const error = await client
      .complete({ messages: [{ role: 'user', content: 'hi' }] })
      .catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(InvalidToolCallError);
    expect(error).toMatchObject({ code: 'ASSISTANT_UNAVAILABLE' });
  });

  it('reports "busy" without waiting when the pause is long', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(limited('60'));
    const client = createLlmClient(
      { baseUrl: 'https://llm.test/v1', model: 'm', apiKey: 'k' },
      fetchImpl,
    );
    await expect(
      client.complete({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('busy'),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
