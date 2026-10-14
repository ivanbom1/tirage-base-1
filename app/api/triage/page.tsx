"use client";

import { useState, type FormEvent } from "react";

export default function TriagePage() {
  const [ticket, setTicket] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSending || !ticket.trim()) return;

    setIsSending(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket }),
      });
      const data: unknown = await response.json();

      if (!response.ok) {
        const detail =
          typeof data === "object" &&
          data !== null &&
          "error" in data &&
          typeof data.error === "string"
            ? data.error
            : "Triage failed. Please try again.";
        throw new Error(detail);
      }

      if (
        typeof data !== "object" ||
        data === null ||
        !("answer" in data) ||
        typeof data.answer !== "string"
      ) {
        throw new Error("The server returned an invalid reply.");
      }

      setResult(data.answer);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Triage failed.");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <main className="chat">
      <h1>Support triage</h1>
      <p>Paste a customer ticket (subject, blank line, body).</p>
      <form onSubmit={submit} aria-busy={isSending}>
        <label htmlFor="ticket">Ticket</label>
        <textarea
          id="ticket"
          value={ticket}
          onChange={(event) => setTicket(event.target.value)}
          rows={10}
          required
          disabled={isSending}
        />
        <button type="submit" disabled={isSending || !ticket.trim()}>
          {isSending ? "Triaging..." : "Triage"}
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
      {result && (
        <section aria-label="Triage result">
          <pre style={{ whiteSpace: "pre-wrap" }}>{result}</pre>
        </section>
      )}
    </main>
  );
}