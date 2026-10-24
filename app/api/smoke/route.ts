import OpenAI from "openai";
import { DATASETS, loadDataset, ticketText, type DatasetTicket } from "../../../lib/dataset";
import { DmError } from "../../../lib/dm";
import { LlmInvalidOutputError } from "../../../lib/llm";
import type { Strategy } from "../../../lib/schema";
import { costOf, logRun } from "../../../lib/runlog";
import { SmokeRequestSchema, type SmokeRow } from "../../../lib/smokeSchema";
import { modelName, triageTicket } from "../../../lib/triage";

const CONCURRENCY = 2; // low on purpose: free API tiers have small per-minute limits

function sample<T>(items: T[], n: number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

function errorCode(err: unknown): string {
  if (err instanceof DmError) return `dm_${err.code}`;
  if (err instanceof LlmInvalidOutputError) return "invalid_model_output";
  if (err instanceof OpenAI.APIConnectionTimeoutError) return "triage_timeout";
  if (err instanceof OpenAI.RateLimitError) return "rate_limited";
  if (err instanceof OpenAI.APIError) return `provider_error_${err.status ?? "unknown"}`;
  return "internal_error";
}

async function runOne(
  t: DatasetTicket,
  labelled: boolean,
  strategy: Strategy,
): Promise<SmokeRow & { ms: number }> {
  const started = Date.now();
  const base = {
    ticket_id: t.ticket_id,
    subject: t.subject ?? "",
    labelled:
      labelled && t.category && t.priority
        ? { category: t.category, priority: t.priority }
        : null,
  };
  try {
    const out = await triageTicket(ticketText(t), strategy);
    return { ...base, predicted: out.result, error: null, usage: out.usage, dm: out.dm, ms: Date.now() - started };
  } catch (err) {
    // A failed ticket is a result, not a reason to stop the run.
    return {
      ...base,
      predicted: null,
      error: errorCode(err),
      usage: err instanceof LlmInvalidOutputError ? err.usage : null,
      dm: null,
      ms: Date.now() - started,
    };
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body.", code: "bad_request" }, { status: 400 });
  }
  const req = SmokeRequestSchema.safeParse(body);
  if (!req.success) {
    return Response.json(
      { error: "Choose a dataset, a strategy and a sample size between 1 and 50.", code: "bad_request" },
      { status: 400 },
    );
  }

  const { dataset, sampleSize, strategy } = req.data;
  const labelled = DATASETS[dataset].labelled;

  let tickets: DatasetTicket[];
  try {
    tickets = await loadDataset(dataset);
  } catch {
    return Response.json(
      { error: `Could not read data/${DATASETS[dataset].file}.`, code: "dataset_unavailable" },
      { status: 500 },
    );
  }

  const picked = sample(tickets, Math.min(sampleSize, tickets.length));
  const timed: (SmokeRow & { ms: number })[] = new Array(picked.length);
  const runStarted = Date.now();
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < picked.length) {
        const i = next++;
        timed[i] = await runOne(picked[i], labelled, strategy);
      }
    }),
  );
  const totalMs = Date.now() - runStarted;
  const rows: SmokeRow[] = timed.map(({ ms, ...row }) => {
    void ms;
    return row;
  });

  const ok = rows.filter((r) => r.predicted);
  const compared = ok.filter((r) => r.labelled);
  const categoryMismatches = labelled
    ? compared.filter((r) => r.predicted!.category !== r.labelled!.category).length
    : null;
  const priorityMismatches = labelled
    ? compared.filter((r) => r.predicted!.priority !== r.labelled!.priority).length
    : null;

  // LLM tokens and decision model tokens are tracked separately.
  const llmUsages = rows.map((r) => r.usage).filter((u) => u !== null);
  const llmIn = llmUsages.length ? llmUsages.reduce((a, u) => a + u.input_tokens, 0) : null;
  const llmOut = llmUsages.length ? llmUsages.reduce((a, u) => a + u.output_tokens, 0) : null;
  const dmUsages = rows.map((r) => r.dm?.usage).filter((u) => u != null);
  const dmIn = dmUsages.length ? dmUsages.reduce((a, u) => a + u.input_tokens, 0) : null;
  const totalTokens =
    llmIn === null && dmIn === null
      ? null
      : (llmIn ?? 0) + (llmOut ?? 0) + (dmIn ?? 0);

  const outcomes: Record<string, number> = {};
  for (const r of rows) {
    const key = r.error ?? "ok";
    outcomes[key] = (outcomes[key] ?? 0) + 1;
  }

  await logRun({
    ts: new Date().toISOString(),
    dataset,
    labelled,
    sample_size: rows.length,
    model: modelName(strategy),
    strategy,
    succeeded: ok.length,
    failed: rows.length - ok.length,
    outcomes,
    category_accuracy:
      categoryMismatches !== null && compared.length ? 1 - categoryMismatches / compared.length : null,
    priority_accuracy:
      priorityMismatches !== null && compared.length ? 1 - priorityMismatches / compared.length : null,
    total_ms: totalMs,
    avg_ticket_ms: Math.round(timed.reduce((a, r) => a + r.ms, 0) / timed.length),
    input_tokens: llmIn,
    output_tokens: llmOut,
    dm_input_tokens: dmIn,
    // The decision model is on a free tier here, so only LLM tokens cost money.
    cost: strategy === "dm" ? 0 : costOf(llmIn, llmOut),
  });

  return Response.json({
    dataset,
    strategy,
    model: modelName(strategy),
    labelled,
    rows,
    summary: {
      total: rows.length,
      succeeded: ok.length,
      failed: rows.length - ok.length,
      categoryMismatches,
      priorityMismatches,
      totalTokens,
    },
  });
}