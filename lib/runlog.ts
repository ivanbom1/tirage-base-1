import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

// One smoke test run = one line in logs/smoke-runs.jsonl.
// No ticket text and no keys are ever written here
const LOG_FILE = path.join(process.cwd(), "logs", "smoke-runs.jsonl");

export const RunLogSchema = z.object({
  ts: z.string(),
  dataset: z.string(),
  labelled: z.boolean(),
  sample_size: z.number(),
  model: z.string(),
  strategy: z.string(), 
  succeeded: z.number(),
  failed: z.number(),
  outcomes: z.record(z.string(), z.number()), 
  category_accuracy: z.number().nullable(), // 0..1, null for unlabelled sets
  priority_accuracy: z.number().nullable(),
  total_ms: z.number(),
  avg_ticket_ms: z.number(),
  input_tokens: z.number().nullable(),
  output_tokens: z.number().nullable(),
  cost: z.number().nullable(),
});

export type RunLog = z.infer<typeof RunLogSchema>;


export function costOf(input: number | null, output: number | null): number | null {
  const pin = Number(process.env.LLM_PRICE_INPUT_PER_M);
  const pout = Number(process.env.LLM_PRICE_OUTPUT_PER_M);
  if (input === null || output === null) return null;
  if (!process.env.LLM_PRICE_INPUT_PER_M || !process.env.LLM_PRICE_OUTPUT_PER_M) return null;
  if (!Number.isFinite(pin) || !Number.isFinite(pout)) return null;
  return (input * pin + output * pout) / 1_000_000;
}


export async function logRun(entry: RunLog): Promise<void> {
  try {
    await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
    await fs.appendFile(LOG_FILE, JSON.stringify(entry) + "\n");
  } catch (err) {
    console.error("could not write run log:", err instanceof Error ? err.name : "unknown");
  }
}

export async function readRuns(): Promise<RunLog[]> {
  let text: string;
  try {
    text = await fs.readFile(LOG_FILE, "utf8");
  } catch {
    return [];
  }
  const runs: RunLog[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = RunLogSchema.safeParse(JSON.parse(line));
      if (parsed.success) runs.push(parsed.data);
    } catch {
      // skip a damaged line
    }
  }
  return runs;
}