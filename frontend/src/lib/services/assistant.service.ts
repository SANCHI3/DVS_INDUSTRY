import api, { unwrap } from '../api';

export interface AssistantAnswer {
  answer:    string;
  toolsUsed: Array<{ name: string; args: Record<string, unknown> }>;
  /** ERP modules the answer is based on, e.g. "Inventory", "Orders". */
  sources:   string[];
  grounded:  boolean;
}

export async function getAssistantStatus(): Promise<{ configured: boolean }> {
  const res = await api.get<{ success: true; data: { configured: boolean } }>('/assistant/status');
  return unwrap(res);
}

export async function askAssistant(question: string): Promise<AssistantAnswer> {
  const res = await api.post<{ success: true; data: AssistantAnswer }>('/assistant/ask', { question });
  return unwrap(res);
}
