import { callModel, LlmInvalidOutputError, type ModelReply } from "./llm";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompt";
import { TriageSchema, type TriageResult, type Usage } from "./schema";

// Some models wrap JSON in a code fence even when told not to.
function stripFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1] : trimmed;
}

// Use 2 (CHECK): string -> unknown -> trusted value.
function parseTriage(
  reply: ModelReply,
): { ok: true; data: TriageResult } | { ok: false; reason: string } {
  if (reply.truncated) return { ok: false, reason: "cut off" };
  let raw: unknown;
  try {
    raw = JSON.parse(stripFence(reply.text));
  } catch {
    return { ok: false, reason: "not JSON" };
  }
  const parsed = TriageSchema.safeParse(raw);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, reason: "schema mismatch" };
}

function addUsage(a: Usage | null, b: Usage | null): Usage | null {
  if (!a) return b;
  if (!b) return a;
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    total_tokens: a.total_tokens + b.total_tokens,
  };
}

export type TriageOutcome = {
  result: TriageResult;
  usage: Usage | null; // summed over attempts, null if never reported
  attempts: number;
};

export async function triageTicket(ticket: string): Promise<TriageOutcome> {
  const user = buildUserMessage(ticket);
  let usage: Usage | null = null;
  let reason = "invalid output";

  // Invalid output -> retries once
  for (let attempt = 1; attempt <= 2; attempt++) {
    const reply = await callModel(SYSTEM_PROMPT, user);
    usage = addUsage(usage, reply.usage);
    const parsed = parseTriage(reply);
    if (parsed.ok) return { result: parsed.data, usage, attempts: attempt };
    reason = parsed.reason;
    console.warn(`triage: invalid model output (${reason}), attempt ${attempt} of 2`);
  }
  // The tokens of the failed attempts were still spent
  throw new LlmInvalidOutputError(reason, usage);
}