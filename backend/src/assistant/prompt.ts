/**
 * Ask DVS system prompt and the deterministic reply for requests to change
 * data (the assistant is read-only, so these never reach the LLM).
 */

export function systemPrompt(today: string, role: string): string {
  return [
    'You are "Ask DVS", the assistant of the DVS Industries factory ERP.',
    `Today is ${today}. The person asking works in the factory with the role ${role}.`,
    '',
    'Rules:',
    '- Answer in 1 to 4 short sentences, in plain everyday words, in the same language the question was written in.',
    '- Use ONLY the names and numbers in the data you looked up for this question. Never guess, estimate or invent anything.',
    '- Every number you write must be one that appears in the looked-up data. Do not calculate new totals, averages or differences.',
    '- If the data has nothing relevant, say you could not find that information.',
    '- Do not use technical words and never mention tools, functions, APIs, databases, JSON or field names.',
    "- Only answer questions about this factory's own data (stock, orders, suppliers, production, attendance, safety incidents, plant health). Politely decline anything else, such as general knowledge, chat or other companies.",
    '- You cannot make changes. If asked to create, approve, edit, cancel or delete something, say you can only look things up and name the page to use: Inventory, Orders & Supply, Production, AI Security or User Management.',
    '- If you need data you are not allowed to see, say that information is not available for your role.',
  ].join('\n');
}

export const NO_RELIABLE_ANSWER = "I couldn't find a reliable answer to that.";

export const INVALID_TOOL_CALL_INSTRUCTION =
  'Your last tool call was rejected because its arguments were not allowed. Call the tool again with only the allowed values. If no allowed value means what the user asked, leave that optional argument out. The error was:';

export const REGROUND_INSTRUCTION =
  'Rewrite your answer using only numbers that appear exactly in the data you looked up. If the data does not contain a number you need, say you could not find it. Keep it to 1 to 4 short sentences.';

const WRITE_VERBS =
  'create|add|make|raise|place|approve|reject|delete|remove|cancel|update|change|edit|modify|set|mark|assign|unassign|dispatch|deliver|close|resolve|record|enter|book|register|deactivate|activate|reset';

// An instruction to change something: the verb comes first, optionally after a
// polite opener ("please", "can you", "I want to").
const WRITE_REQUEST = new RegExp(
  `^(?:(?:please|pls|kindly|hey|ok|okay)[\\s,]+)*(?:(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?|i\\s+(?:want|need|would\\s+like)\\s+(?:you\\s+)?to\\s+|help\\s+me\\s+|go\\s+ahead\\s+and\\s+)?(?:${WRITE_VERBS})\\b`,
  'i',
);

const PAGE_HINTS: Array<{ pattern: RegExp; page: string }> = [
  {
    pattern: /incident|alert|fire|smoke|fall|fight|crowd|camera|cctv|safety/i,
    page: 'AI Security',
  },
  { pattern: /attendance|shift|leave|absent|present|clock/i, page: 'Production (Attendance tab)' },
  { pattern: /work order|production|output|batch/i, page: 'Production' },
  {
    pattern:
      /purchase order|\bpo\b|supplier|vendor|client|customer|dispatch|deliver|sales order|order/i,
    page: 'Orders & Supply',
  },
  { pattern: /material|stock|inventory|scrap|item/i, page: 'Inventory' },
  { pattern: /user|account|password|role|login/i, page: 'User Management' },
];

/** The fixed reply for a request to change data, or null for a question. */
export function writeRequestReply(question: string): string | null {
  if (!WRITE_REQUEST.test(question.trim())) return null;
  const page = PAGE_HINTS.find((hint) => hint.pattern.test(question))?.page;
  return page
    ? `I can only look things up, I can't make changes. Please use the ${page} page to do that.`
    : "I can only look things up, I can't make changes. Please use the matching page in the menu to do that.";
}
