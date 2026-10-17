/**
 * Minimal client for an OpenAI-compatible chat-completions API with tool
 * calling (Groq by default). Uses native fetch; no SDK dependency.
 */
import { AppError } from '../errors';

export const LLM_TIMEOUT_MS = 30_000;

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

export function createLlmClient(config: LlmConfig, fetchImpl: typeof fetch = fetch): LlmClient {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  return {
    async complete({ messages, tools, toolChoice = 'auto' }) {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
          body: JSON.stringify({
            model: config.model,
            messages,
            temperature: 0,
            ...(tools && tools.length > 0 ? { tools, tool_choice: toolChoice } : {}),
          }),
          signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
        });
      } catch (err) {
        const timedOut =
          err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
        throw new AppError(
          timedOut
            ? 'The assistant took too long to answer. Please try again.'
            : 'The assistant service could not be reached. Please try again later.',
          timedOut ? 504 : 502,
          timedOut ? 'ASSISTANT_TIMEOUT' : 'ASSISTANT_UNAVAILABLE',
        );
      }
      if (!response.ok) {
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
    },
  };
}
