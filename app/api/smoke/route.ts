import OpenAI from "openai";
import { DATASETS, loadDataset, ticketText, type DatasetTicket } from "../../../lib/dataset";
import { LlmInvalidOutputError, MODEL } from "../../../lib/llm";
import { costOf, logRun } from "../../../lib/runlog";
import { SmokeRequestSchema, type SmokeRow } from "../../../lib/smokeSchema";
import { triageTicket } from "../../../lib/triage";

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
  if (err instanceof LlmInvalidOutputError) return "invalid_model_output";
  if (err instanceof OpenAI.APIConnectionTimeoutError) return "triage_timeout";
  if (err instanceof OpenAI.RateLimitError) return "rate_limited";
  if (err instanceof OpenAI.APIError) return `provider_error_${err.status ?? "unknown"}`;
  return "internal_error";
}

async function runOne(t: DatasetTicket, labelled: boolean): Promise<SmokeRow & { ms: number }> {
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
    const out = await triageTicket(ticketText(t));
    return { ...base, predicted: out.result, error: null, usage: out.usage, ms: Date.now() - started };
  } catch (err) {
    // A failed ticket is a result, not a reason to stop the run.
    return {
      ...base,
      predicted: null,
      error: errorCode(err),
      usage: err instanceof LlmInvalidOutputError ? err.usage : null,
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
      { error: "Choose a dataset and a sample size between 1 and 50.", code: "bad_request" },
      { status: 400 },
    );
  }

  const { dataset, sampleSize } = req.data;
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
        timed[i] = await runOne(picked[i], labelled);
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
  const tokens = rows.map((r) => r.usage?.total_tokens).filter((v): v is number => v != null);

  const categoryMismatches = labelled
    ? compared.filter((r) => r.predicted!.category !== r.labelled!.category).length
    : null;
  const priorityMismatches = labelled
    ? compared.filter((r) => r.predicted!.priority !== r.labelled!.priority).length
    : null;

  // Log this run (accuracy, outcome counts, latency, cost, model).
  const usages = rows.map((r) => r.usage).filter((u) => u !== null);
  const inputTokens = usages.length ? usages.reduce((a, u) => a + u.input_tokens, 0) : null;
  const outputTokens = usages.length ? usages.reduce((a, u) => a + u.output_tokens, 0) : null;
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
    model: MODEL,
    strategy: "llm",
    succeeded: ok.length,
    failed: rows.length - ok.length,
    outcomes,
    category_accuracy:
      categoryMismatches !== null && compared.length ? 1 - categoryMismatches / compared.length : null,
    priority_accuracy:
      priorityMismatches !== null && compared.length ? 1 - priorityMismatches / compared.length : null,
    total_ms: totalMs,
    avg_ticket_ms: Math.round(timed.reduce((a, r) => a + r.ms, 0) / timed.length),
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost: costOf(inputTokens, outputTokens),
  });

  return Response.json({
    dataset,
    labelled,
    rows,
    summary: {
      total: rows.length,
      succeeded: ok.length,
      failed: rows.length - ok.length,
      categoryMismatches,
      priorityMismatches,
      totalTokens: tokens.length ? tokens.reduce((a, b) => a + b, 0) : null,
    },
  });
}