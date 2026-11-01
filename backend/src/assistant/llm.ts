/**
 * Minimal client for an OpenAI-compatible chat-completions API with tool
 * calling (Groq by default). Uses native fetch; no SDK dependency.
 */
import { AppError } from '../errors';

export const LLM_TIMEOUT_MS = 30_000;
/**
 * Whole-answer budget across every model call for one question. The browser
 * waits 60 s for /assistant/ask, so the server gives up first and says so.
 */
export const ANSWER_BUDGET_MS = 50_000;

export function assistantTimeoutError(): AppError {
  return new AppError(
    'That took too long. Please try again, or ask a shorter question.',
    504,
    'ASSISTANT_TIMEOUT',
  );
}
/** Longest rate-limit pause worth waiting for before telling the user to try later. */
export const MAX_RATE_LIMIT_WAIT_MS = 10_000;

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface CompletionRequest {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  /** Abort this call after this many ms (capped at LLM_TIMEOUT_MS). */
  timeoutMs?: number;
  /** 'none' forces a text answer even when tools are listed. */
  toolChoice?: 'auto' | 'none';
}

export interface CompletionResult {
  content: string | null;
  toolCalls: ToolCall[];
}

export interface LlmClient {
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

export interface LlmConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] } }>;
}

/**
 * The provider rejected a tool call the model wrote (Groq: HTTP 400
 * "tool_use_failed", e.g. an argument outside the allowed values). `detail` is
 * the provider's explanation, so the model can be asked to correct the call.
 */
export class InvalidToolCallError extends AppError {
  constructor(readonly detail: string) {
    super(
      'The assistant service is unavailable right now. Please try again later.',
      502,
      'ASSISTANT_UNAVAILABLE',
    );
  }
}

async function invalidToolCallDetail(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    return body.error?.code === 'tool_use_failed' ? (body.error.message ?? '') : null;
  } catch {
    return null;
  }
}

export function createLlmClient(config: LlmConfig, fetchImpl: typeof fetch = fetch): LlmClient {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  async function send({
    messages,
    tools,
    toolChoice = 'auto',
    timeoutMs = LLM_TIMEOUT_MS,
  }: CompletionRequest): Promise<Response> {
    try {
      return await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature: 0,
          ...(tools && tools.length > 0 ? { tools, tool_choice: toolChoice } : {}),
        }),
        signal: AbortSignal.timeout(Math.max(1, Math.min(timeoutMs, LLM_TIMEOUT_MS))),
      });
    } catch (err) {
      const timedOut =
        err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      if (timedOut) throw assistantTimeoutError();
      throw new AppError(
        'The assistant service could not be reached. Please try again later.',
        502,
        'ASSISTANT_UNAVAILABLE',
      );
    }
  }

  async function read(response: Response): Promise<CompletionResult> {
    if (!response.ok) {
      const detail = response.status === 400 ? await invalidToolCallDetail(response) : null;
      if (detail !== null) throw new InvalidToolCallError(detail);
      throw new AppError(
        response.status === 429
          ? 'The assistant is busy right now. Please try again in a minute.'
          : 'The assistant service is unavailable right now. Please try again later.',
        502,
        'ASSISTANT_UNAVAILABLE',
      );
    }
    const body = (await response.json()) as ChatCompletionResponse;
    const message = body.choices?.[0]?.message;
    return { content: message?.content ?? null, toolCalls: message?.tool_calls ?? [] };
  }

  return {
    async complete(request) {
      const response = await send(request);
      if (response.status !== 429) return read(response);
      // Rate limited: wait once when the provider asks for a short pause.
      const retryAfterMs = Number(response.headers.get('retry-after')) * 1000;
      if (!(retryAfterMs > 0 && retryAfterMs <= MAX_RATE_LIMIT_WAIT_MS)) return read(response);
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
      return read(await send(request));
    },
  };
}
