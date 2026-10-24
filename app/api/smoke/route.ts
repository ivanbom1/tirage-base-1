import OpenAI from "openai";
import { DATASETS, loadDataset, ticketText, type DatasetTicket } from "../../../lib/dataset";
import { LlmInvalidOutputError } from "../../../lib/llm";
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

async function runOne(t: DatasetTicket, labelled: boolean): Promise<SmokeRow> {
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
    return { ...base, predicted: out.result, error: null, usage: out.usage };
  } catch (err) {
    // A failed ticket is a result, not a reason to stop the run.
    return {
      ...base,
      predicted: null,
      error: errorCode(err),
      usage: err instanceof LlmInvalidOutputError ? err.usage : null,
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
  const rows: SmokeRow[] = new Array(picked.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < picked.length) {
        const i = next++;
        rows[i] = await runOne(picked[i], labelled);
      }
    }),
  );

  const ok = rows.filter((r) => r.predicted);
  const compared = ok.filter((r) => r.labelled);
  const tokens = rows.map((r) => r.usage?.total_tokens).filter((v): v is number => v != null);

  return Response.json({
    dataset,
    labelled,
    rows,
    summary: {
      total: rows.length,
      succeeded: ok.length,
      failed: rows.length - ok.length,
      categoryMismatches: labelled
        ? compared.filter((r) => r.predicted!.category !== r.labelled!.category).length
        : null,
      priorityMismatches: labelled
        ? compared.filter((r) => r.predicted!.priority !== r.labelled!.priority).length
        : null,
      totalTokens: tokens.length ? tokens.reduce((a, b) => a + b, 0) : null,
    },
  });
}