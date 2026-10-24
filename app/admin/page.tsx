import { readRuns } from "../../lib/runlog";

// Read the log on every visit, never from a build-time cache.
export const dynamic = "force-dynamic";

const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(0)}%`);
const num = (v: number | null) => (v === null ? "n/a" : v.toLocaleString("en"));
const money = (v: number | null) => (v === null ? "unknown" : v.toFixed(6));
const cell = { padding: "6px 10px", textAlign: "left" as const, borderBottom: "1px solid #ccd3df" };

export default async function AdminPage() {
  const runs = [...(await readRuns())].reverse();
  const head = [
    "Time", "Dataset", "Model", "Strategy", "Tickets", "Outcomes",
    "Category acc.", "Priority acc.", "Avg ms/ticket", "Total ms", "Tokens in/out", "Cost",
  ];

  return (
    <main style={{ maxWidth: 1200, margin: "48px auto", padding: 24 }}>
      <h1>Admin: smoke test runs</h1>
      <p>{runs.length} logged run(s).</p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
          <thead>
            <tr>{head.map((h) => <th key={h} style={cell}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {runs.map((r, i) => (
              <tr key={i}>
                <td style={cell}>{r.ts.replace("T", " ").slice(0, 19)}</td>
                <td style={cell}>{r.dataset}</td>
                <td style={cell}>{r.model}</td>
                <td style={cell}>{r.strategy}</td>
                <td style={cell}>{r.sample_size}</td>
                <td style={cell}>
                  {Object.entries(r.outcomes).map(([k, v]) => `${k}: ${v}`).join(", ")}
                </td>
                <td style={cell}>{pct(r.category_accuracy)}</td>
                <td style={cell}>{pct(r.priority_accuracy)}</td>
                <td style={cell}>{num(r.avg_ticket_ms)}</td>
                <td style={cell}>{num(r.total_ms)}</td>
                <td style={cell}>{num(r.input_tokens)} / {num(r.output_tokens)}</td>
                <td style={cell}>{money(r.cost)}</td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr><td style={cell} colSpan={head.length}>No runs logged yet. Run a smoke test first.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}