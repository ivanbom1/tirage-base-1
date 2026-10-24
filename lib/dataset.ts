import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

// Server-only. Change the file names here if yours are different.
export const DATASETS = {
  labelled100: { file: "support_tickets_100_labelled.json", labelled: true },
  tickets500: { file: "support_tickets_500.json", labelled: false },
} as const;

export type DatasetId = keyof typeof DATASETS;

const TicketSchema = z.object({
  ticket_id: z.string(),
  subject: z.string().nullish(),
  body: z.string(),
  category: z.string().optional(),
  priority: z.string().optional(),
});

export type DatasetTicket = z.infer<typeof TicketSchema>;

export async function loadDataset(id: DatasetId): Promise<DatasetTicket[]> {
  const file = path.join(process.cwd(), "data", DATASETS[id].file);
  const raw = JSON.parse(await fs.readFile(file, "utf8"));
  return z.array(TicketSchema).parse(raw);
}

// Same text as the triage page builds: subject + blank line + body.
export const ticketText = (t: DatasetTicket) => `${t.subject ?? ""}\n\n${t.body}`;