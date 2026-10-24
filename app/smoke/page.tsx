"use client";

import { useState, type FormEvent } from "react";
import { SmokeResponseSchema, type SmokeResponse } from "../../lib/smokeSchema";

export default function SmokePage() {
  const [dataset, setDataset] = useState("labelled100");
  const [sampleSize, setSampleSize] = useState(5);
  const [data, setData] = useState<SmokeResponse | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isRunning) return;
    setIsRunning(true);
    setError(null);
    setData(null);
    try {
      const response = await fetch("/api/smoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataset, sampleSize }),
      });
      const json: unknown = await response.json();
      if (!response.ok) {
        const detail =
          typeof json === "object" && json !== null && "error" in json && typeof json.error === "string"
            ? json.error
            : "The smoke test failed.";
        throw new Error(detail);
      }
      const parsed = SmokeResponseSchema.safeParse(json);
      if (!parsed.success) throw new Error("The server returned an invalid reply.");
      setData(parsed.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The smoke test failed.");
    } finally {
      setIsRunning(false);
    }
  }

  const cell = { padding: "6px 10px", textAlign: "left" as const, borderBottom: "1px solid #ccd3df" };
  const bad = { ...cell, background: "#ffe3e3" };

  return (
    <main className="chat">
      <h1>Smoke test</h1>
      <form onSubmit={run} aria-busy={isRunning}>
        <label htmlFor="dataset">Dataset</label>
        <select id="dataset" value={dataset} onChange={(e) => setDataset(e.target.value)} disabled={isRunning}>
          <option value="labelled100">Labelled set (100 tickets)</option>
          <option value="tickets500">500-ticket set (no labels)</option>
        </select>
        <label htmlFor="size">Random sample size (1 to 50)</label>
        <input
          id="size"
          type="number"
          min={1}
          max={50}
          value={sampleSize}
          onChange={(e) => setSampleSize(Number(e.target.value))}
          disabled={isRunning}
        />
        <button type="submit" disabled={isRunning || !Number.isInteger(sampleSize) || sampleSize < 1 || sampleSize > 50}>
          {isRunning ? "Running..." : "Run smoke test"}
        </button>
        {error && <p role="alert">{error}</p>}
      </form>

      {data && (
        <section aria-label="Smoke test results">
          <h2>Summary</h2>
          <p>
            {data.summary.total} tickets: {data.summary.succeeded} succeeded, {data.summary.failed} failed.
            {data.summary.totalTokens !== null && ` Total tokens: ${data.summary.totalTokens}.`}
          </p>
          {data.labelled ? (
            <p>
              Mismatches (of {data.summary.succeeded} successful): category {data.summary.categoryMismatches}, priority{" "}
              {data.summary.priorityMismatches}.
            </p>
          ) : (
            <p>This dataset has no labels, so there is nothing to compare.</p>
          )}

          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={cell}>Ticket</th>
                  <th style={cell}>Subject</th>
                  <th style={cell}>Category (predicted)</th>
                  {data.labelled && <th style={cell}>Category (labelled)</th>}
                  <th style={cell}>Priority (predicted)</th>
                  {data.labelled && <th style={cell}>Priority (labelled)</th>}
                  <th style={cell}>Tokens</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const catBad = !!r.predicted && !!r.labelled && r.predicted.category !== r.labelled.category;
                  const priBad = !!r.predicted && !!r.labelled && r.predicted.priority !== r.labelled.priority;
                  return (
                    <tr key={r.ticket_id}>
                      <td style={cell}>{r.ticket_id}</td>
                      <td style={cell}>{r.subject || "(no subject)"}</td>
                      {r.predicted ? (
                        <>
                          <td style={catBad ? bad : cell}>{r.predicted.category}</td>
                          {data.labelled && <td style={catBad ? bad : cell}>{r.labelled?.category ?? "-"}</td>}
                          <td style={priBad ? bad : cell}>{r.predicted.priority}</td>
                          {data.labelled && <td style={priBad ? bad : cell}>{r.labelled?.priority ?? "-"}</td>}
                        </>
                      ) : (
                        <td style={bad} colSpan={data.labelled ? 4 : 2}>
                          failed: {r.error}
                        </td>
                      )}
                      <td style={cell}>{r.usage ? r.usage.total_tokens : "n/a"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}