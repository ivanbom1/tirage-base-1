import { z } from "zod";
import { TriageSchema, type DmInfo } from "./schema";

// Calls a hosted decision model (vLLM Semantic Router "Decision 3.0").
// POST /v1/systemone with a "state" (the ticket, untrusted text) and typed "questions".
// Config (.env): DM_API_KEY (required), DM_BASE_URL, DM_MODEL.

export class DmError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(`decision model error ${status} ${code}`);
    this.name = "DmError";
    this.status = status;
    this.code = code;
  }
}

const BASE_URL = process.env.DM_BASE_URL ?? "https://decision.vllm-sr.ai";
export const DM_MODEL = process.env.DM_MODEL ?? "vllm-sr/d3-flash";
const MAX_STATE_CHARS = 6000; // keep requests well under the provider's input limit

// criteria = the decision guidance, as data: the options and what each one means.
const QUESTIONS = {
  category: {
    type: "choice",
    instructions: "Which category best describes what the customer needs?",
    criteria: {
      billing: "invoices, charges, refunds, payment methods, VAT numbers, subscriptions, cancellations",
      technical_bug: "something in the product is broken, slow, wrong or crashing; also product how-to questions",
      account: "login, access, permissions, workspace members, security, profile settings, personal data requests",
      feature_request: "asks for a new capability or an improvement that does not exist yet",
    },
  },
  priority: {
    type: "choice",
    instructions: "How urgent is this ticket, judged by business impact and not by the customer's tone?",
    criteria: {
      low: "cosmetic issue, question or wish; no deadline and nothing is blocked",
      medium: "real problem or request with limited impact or a workaround",
      high: "production broken, wrong or lost data, security exposure, money at stake, or a hard deadline",
    },
  },
};

const ChoiceAnswer = z.object({
  choice: z.string(),
  probabilities: z.record(z.string(), z.number()).optional(),
  confidence: z.number().optional(),
});

const DmResponse = z.object({
  answers: z.object({ category: ChoiceAnswer, priority: ChoiceAnswer }),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number().optional() }),
});

export type DmDecision = {
  category: z.infer<typeof TriageSchema>["category"];
  priority: z.infer<typeof TriageSchema>["priority"];
  info: DmInfo;
};

export async function callDm(ticket: string): Promise<DmDecision> {
  const key = process.env.DM_API_KEY;
  if (!key) throw new DmError(500, "dm_not_configured");

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/v1/systemone`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: DM_MODEL,
        state: ticket.slice(0, MAX_STATE_CHARS),
        questions: QUESTIONS,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new DmError(504, "timeout");
    }
    throw new DmError(502, "unreachable");
  }

  if (!res.ok) {
    let code = "http_error";
    try {
      const body = await res.json();
      if (typeof body?.error?.code === "string") code = body.error.code;
    } catch {
    }
    throw new DmError(res.status, code);
  }

  // string -> unknown -> trusted value, like the LLM path.
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    throw new DmError(502, "invalid_dm_output");
  }
  const parsed = DmResponse.safeParse(raw);
  if (!parsed.success) throw new DmError(502, "invalid_dm_output");
  const { answers, usage } = parsed.data;

  const category = TriageSchema.shape.category.safeParse(answers.category.choice);
  const priority = TriageSchema.shape.priority.safeParse(answers.priority.choice);
  if (!category.success || !priority.success) throw new DmError(502, "invalid_dm_output");

  const conf = (a: z.infer<typeof ChoiceAnswer>) => a.confidence ?? a.probabilities?.[a.choice] ?? null;
  const input = usage.input_tokens;
  const output = usage.output_tokens ?? 0;
  return {
    category: category.data,
    priority: priority.data,
    info: {
      model: DM_MODEL,
      usage: { input_tokens: input, output_tokens: output, total_tokens: input + output },
      category_confidence: conf(answers.category),
      priority_confidence: conf(answers.priority),
    },
  };
}