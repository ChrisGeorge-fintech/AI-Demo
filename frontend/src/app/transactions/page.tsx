"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";

interface Transaction {
  description: string;
  amount: string;
}

interface Classification {
  transaction: string;
  amount: number;
  budget_code: string;
  budget_line: string;
  meets_requirements: boolean;
  reason: string;
}

function getToken(): string {
  return document.cookie.split("; ").find((r) => r.startsWith("token="))?.split("=")[1] ?? "";
}

const SAMPLE_TRANSACTIONS: Transaction[] = [
  { description: "Office stationery purchase", amount: "125" },
  { description: "Cloud hosting fees", amount: "850" },
  { description: "Staff training workshop", amount: "2200" },
  { description: "Fuel reimbursement - field audit", amount: "310.50" },
  { description: "External audit fees", amount: "15000" },
];

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([{ description: "", amount: "" }]);
  const [results, setResults] = useState<Classification[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function updateRow(i: number, field: keyof Transaction, value: string) {
    setTransactions((prev) => prev.map((r, j) => j === i ? { ...r, [field]: value } : r));
  }

  function addRow() {
    setTransactions((prev) => [...prev, { description: "", amount: "" }]);
  }

  function removeRow(i: number) {
    setTransactions((prev) => prev.filter((_, j) => j !== i));
  }

  function loadSamples() {
    setTransactions(SAMPLE_TRANSACTIONS);
    setResults(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const valid = transactions.filter((t) => t.description.trim() && t.amount.trim());
    if (valid.length === 0) return;

    setError("");
    setResults(null);
    setLoading(true);

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/transactions/classify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          transactions: valid.map((t) => ({ description: t.description, amount: parseFloat(t.amount) })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Classification failed");
      setResults(data.classifications);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-4">
        <Link href="/" className="text-gray-400 hover:text-gray-600 text-sm">← Home</Link>
        <h1 className="text-lg font-semibold">Transaction Classifier</h1>
        <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Budget RAG</span>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-8 space-y-8">
        {/* Input form */}
        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-medium text-gray-800">Transactions</h2>
            <button type="button" onClick={loadSamples} className="text-xs text-blue-600 hover:underline">Load samples</button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-12 gap-2 text-xs font-medium text-gray-500 px-1">
              <span className="col-span-8">Description</span>
              <span className="col-span-3">Amount</span>
            </div>

            {transactions.map((row, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <input
                  type="text"
                  value={row.description}
                  onChange={(e) => updateRow(i, "description", e.target.value)}
                  placeholder="e.g. Office stationery"
                  className="col-span-8 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={row.amount}
                  onChange={(e) => updateRow(i, "amount", e.target.value)}
                  placeholder="0.00"
                  className="col-span-3 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button type="button" onClick={() => removeRow(i)} disabled={transactions.length === 1}
                  className="col-span-1 text-gray-400 hover:text-red-500 disabled:opacity-30 text-lg leading-none">×</button>
              </div>
            ))}

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={addRow}
                className="text-sm text-blue-600 hover:underline border border-blue-200 rounded-lg px-3 py-1.5">
                + Add row
              </button>
              <button
                type="submit"
                disabled={loading || transactions.every((t) => !t.description.trim())}
                className="ml-auto bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-6 py-2 rounded-xl text-sm font-medium transition-colors"
              >
                {loading ? "Classifying…" : "Classify"}
              </button>
            </div>
          </form>
        </div>

        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</div>}

        {loading && (
          <div className="bg-white border border-gray-200 rounded-2xl p-12 flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-400">Retrieving budget rules and classifying…</p>
          </div>
        )}

        {/* Results table */}
        {results && !loading && (
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="font-medium text-gray-800">Classification Results</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b text-xs text-gray-500 font-medium uppercase tracking-wide">
                    <th className="px-4 py-3 text-left">Transaction</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3 text-left">Budget Code</th>
                    <th className="px-4 py-3 text-left">Budget Line</th>
                    <th className="px-4 py-3 text-center">Compliant</th>
                    <th className="px-4 py-3 text-left">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-3 max-w-[180px] truncate" title={r.transaction}>{r.transaction}</td>
                      <td className="px-4 py-3 text-right font-mono">{r.amount?.toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">{r.budget_code}</code>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{r.budget_line}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${r.meets_requirements ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                          {r.meets_requirements ? "Yes" : "No"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs max-w-[240px]">{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Summary row */}
            <div className="px-6 py-3 bg-gray-50 border-t text-xs text-gray-500 flex gap-6">
              <span>{results.length} transactions</span>
              <span className="text-green-600">{results.filter((r) => r.meets_requirements).length} compliant</span>
              <span className="text-red-600">{results.filter((r) => !r.meets_requirements).length} non-compliant</span>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
