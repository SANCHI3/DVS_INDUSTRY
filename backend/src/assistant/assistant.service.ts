/**
 * Ask DVS: answers staff questions from live ERP data.
 *
 * 1. Requests to change data get a fixed "use the page" reply (no LLM call).
 * 2. The LLM may call up to MAX_TOOL_ROUNDS rounds of read-only tools, limited
 *    to the user's role; every call is role-checked again on execution.
 * 3. The final answer is grounded: each number must appear in this
 *    conversation's tool results (or the question / today's date). One retry
 *    asks the LLM to use only the tool results; after that the answer is
 *    replaced by NO_RELIABLE_ANSWER. An ungrounded number is never returned.
 * 4. Each question is written to the audit log (no tool payloads).
 */
import { env } from '../config/env';
import { AppError, ForbiddenError } from '../errors';
import { AuditRepository } from '../repositories/audit.repository';
import { logger } from '../logger';
import { checkGrounding } from './grounding';
import { createLlmClient, type ChatMessage, type LlmClient } from './llm';
import {
  NO_RELIABLE_ANSWER,
  REGROUND_INSTRUCTION,
  systemPrompt,
  writeRequestReply,
} from './prompt';
import {
  day,
  executeTool,
  toolSpecs,
  toolsForRole,
  type AssistantModule,
  type AssistantUser,
  type ToolRun,
} from './tools';

export const MAX_TOOL_ROUNDS = 3;

export const NOT_CONFIGURED_MESSAGE =
  'Assistant not configured. An administrator needs to set ASSISTANT_LLM_API_KEY in backend/.env.';

export interface AskResult {
  answer: string;
  toolsUsed: Array<{ name: string; args: Record<string, unknown> }>;
  sources: AssistantModule[];
  grounded: boolean;
}

export interface AuditEntry {
  user: AssistantUser;
  question: string;
  toolsUsed: string[];
  grounded: boolean;
  durationMs: number;
  outcome: 'answered' | 'write_request' | 'error';
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AssistantServiceOptions {
  /** null = not configured. Defaults to a client built from env. */
  llm?: LlmClient | null;
  audit?: (entry: AuditEntry) => Promise<void>;
  execute?: typeof executeTool;
  now?: () => Date;
}

const auditRepo = new AuditRepository();

async function writeAudit(entry: AuditEntry): Promise<void> {
  await auditRepo.log({
    userId: entry.user.id,
    userEmail: entry.user.email,
    userRole: entry.user.role,
    action: 'EXPORT', // the assistant reads ERP data out, like a report export
    entity: 'AssistantQuestion',
    method: 'POST',
    path: '/api/v1/assistant/ask',
    statusCode: entry.outcome === 'error' ? 502 : 200,
    after: {
      question: entry.question,
      toolsUsed: entry.toolsUsed,
      grounded: entry.grounded,
      durationMs: entry.durationMs,
      outcome: entry.outcome,
    },
    ipAddress: entry.ipAddress ?? null,
    userAgent: entry.userAgent ?? null,
  });
}

function defaultLlm(): LlmClient | null {
  if (!env.ASSISTANT_LLM_API_KEY) return null;
  return createLlmClient({
    baseUrl: env.ASSISTANT_LLM_BASE_URL,
    model: env.ASSISTANT_LLM_MODEL,
    apiKey: env.ASSISTANT_LLM_API_KEY,
  });
}

/** Plain hyphens instead of the non-breaking ones some models emit (PO‑0012), so numbers can be copied and searched. */
function tidy(text: string | null | undefined): string {
  return (text ?? '').replace(/[\u2010\u2011]/g, '-').trim();
}

function parseArgs(raw: string): unknown {
  try {
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export class AssistantService {
  private readonly llm: LlmClient | null;
  private readonly audit: (entry: AuditEntry) => Promise<void>;
  private readonly execute: typeof executeTool;
  private readonly now: () => Date;

  constructor(options: AssistantServiceOptions = {}) {
    this.llm = options.llm === undefined ? defaultLlm() : options.llm;
    this.audit = options.audit ?? writeAudit;
    this.execute = options.execute ?? executeTool;
    this.now = options.now ?? (() => new Date());
  }

  get configured(): boolean {
    return this.llm !== null;
  }

  async ask(
    question: string,
    user: AssistantUser,
    meta: { ipAddress?: string | null; userAgent?: string | null } = {},
  ): Promise<AskResult> {
    if (this.llm === null)
      throw new AppError(NOT_CONFIGURED_MESSAGE, 503, 'ASSISTANT_NOT_CONFIGURED');
    const started = Date.now();
    const record = (result: AskResult, outcome: AuditEntry['outcome']) =>
      this.audit({
        user,
        question,
        toolsUsed: result.toolsUsed.map((t) => t.name),
        grounded: result.grounded,
        durationMs: Date.now() - started,
        outcome,
        ...meta,
      }).catch((err: unknown) => logger.error('Assistant audit failed', { err }));

    const writeReply = writeRequestReply(question);
    if (writeReply !== null) {
      const result: AskResult = { answer: writeReply, toolsUsed: [], sources: [], grounded: true };
      await record(result, 'write_request');
      return result;
    }

    try {
      const result = await this.answer(this.llm, question, user);
      await record(result, 'answered');
      return result;
    } catch (err) {
      await record({ answer: '', toolsUsed: [], sources: [], grounded: false }, 'error');
      throw err;
    }
  }

  private async answer(llm: LlmClient, question: string, user: AssistantUser): Promise<AskResult> {
    const now = this.now();
    const tools = toolsForRole(user.role);
    const specs = toolSpecs(tools);
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt(day(now) ?? now.toDateString(), user.role) },
      { role: 'user', content: question },
    ];
    const runs: ToolRun[] = [];
    const evidence: string[] = [question, day(now) ?? ''];

    let answer: string;
    for (let round = 0; ; round++) {
      const canUseTools = specs.length > 0 && round < MAX_TOOL_ROUNDS;
      const reply = await llm.complete({
        messages,
        ...(specs.length > 0 ? { tools: specs, toolChoice: canUseTools ? 'auto' : 'none' } : {}),
      });
      if (!canUseTools || reply.toolCalls.length === 0) {
        answer = tidy(reply.content);
        break;
      }
      messages.push({ role: 'assistant', content: reply.content, tool_calls: reply.toolCalls });
      for (const call of reply.toolCalls) {
        let content: string;
        try {
          const run = await this.execute(
            call.function.name,
            parseArgs(call.function.arguments),
            user,
            now,
          );
          runs.push(run);
          content = JSON.stringify(run.result);
          evidence.push(content);
        } catch (err) {
          content = JSON.stringify({
            error:
              err instanceof ForbiddenError
                ? 'This information is not available for your role.'
                : 'This information could not be loaded.',
          });
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content });
      }
    }

    const toolsUsed = runs.map((run) => ({ name: run.name, args: run.args }));
    const sources = [...new Set(runs.map((run) => run.module))];

    if (answer && checkGrounding(answer, evidence).grounded) {
      return { answer, toolsUsed, sources, grounded: true };
    }

    if (answer) {
      // One retry: the same conversation, told to use only the tool results.
      messages.push({ role: 'assistant', content: answer });
      messages.push({ role: 'user', content: REGROUND_INSTRUCTION });
      const retry = await llm.complete({
        messages,
        ...(specs.length > 0 ? { tools: specs, toolChoice: 'none' as const } : {}),
      });
      const retried = tidy(retry.content);
      if (retried && checkGrounding(retried, evidence).grounded) {
        return { answer: retried, toolsUsed, sources, grounded: true };
      }
    }

    return { answer: NO_RELIABLE_ANSWER, toolsUsed, sources, grounded: false };
  }
}
