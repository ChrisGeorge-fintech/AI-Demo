"use client";

import { useState, useRef, useEffect, FormEvent } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Message {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  attachments?: string[]; // display file names in the user bubble
}

const MAX_FILES = 3;
const MAX_FILE_MB = 10;
const ACCEPTED = ".pdf,.csv,.txt";

function getToken(): string {
  return document.cookie
    .split("; ")
    .find((row) => row.startsWith("token="))
    ?.split("=")[1] ?? "";
}

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(0)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    const combined = [...files, ...selected];
    const oversized = combined.filter((f) => f.size > MAX_FILE_MB * 1024 * 1024);
    if (oversized.length) {
      setError(`File(s) exceed ${MAX_FILE_MB} MB: ${oversized.map((f) => f.name).join(", ")}`);
      e.target.value = "";
      return;
    }
    if (combined.length > MAX_FILES) {
      setError(`Maximum ${MAX_FILES} files per message.`);
      e.target.value = "";
      return;
    }
    setError("");
    setFiles(combined);
    e.target.value = "";
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function sendMessage(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    const attachedFiles = [...files];
    setInput("");
    setFiles([]);
    setError("");

    const history = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      content: m.content,
    }));

    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: userMessage,
        attachments: attachedFiles.map((f) => f.name),
      },
    ]);
    setLoading(true);
    setMessages((prev) => [...prev, { role: "assistant", content: "", streaming: true }]);

    try {
      const body = new FormData();
      body.append("message", userMessage);
      body.append("history", JSON.stringify(history));
      attachedFiles.forEach((f) => body.append("files", f));

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/chat/message`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
        body,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `Server error: ${res.status}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const payload = JSON.parse(line.slice(6));
            if (payload.chunk) {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                updated[updated.length - 1] = { ...last, content: last.content + payload.chunk };
                return updated;
              });
            }
            if (payload.done) {
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { ...updated[updated.length - 1], streaming: false };
                return updated;
              });
            }
          } catch {/* ignore malformed chunks */}
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setMessages((prev) => prev.filter((m) => !(m.role === "assistant" && m.streaming)));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-4">
        <Link href="/" className="text-gray-400 hover:text-gray-600 text-sm">← Home</Link>
        <h1 className="text-lg font-semibold">AI Chat Assistant</h1>
        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Accounting & Auditing</span>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 mt-20">
            <p className="text-lg mb-2">Ask me anything about accounting or auditing</p>
            <p className="text-sm">
              e.g. "Explain the matching principle" or "What are ISA 700 requirements?"
            </p>
            <p className="text-xs mt-3 text-gray-300">
              You can attach a PDF, CSV, or TXT file to give the assistant context for your question.
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-2xl px-4 py-3 rounded-2xl text-sm ${
                msg.role === "user"
                  ? "bg-blue-600 text-white rounded-br-sm whitespace-pre-wrap"
                  : "bg-white border border-gray-200 text-gray-800 rounded-bl-sm shadow-sm"
              }`}
            >
              {msg.role === "user" ? (
                <>
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {msg.attachments.map((name, j) => (
                        <span key={j} className="inline-flex items-center gap-1 bg-blue-500 text-white text-xs px-2 py-0.5 rounded-full">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                          </svg>
                          {name}
                        </span>
                      ))}
                    </div>
                  )}
                  {msg.content}
                </>
              ) : (
                <div className="prose prose-sm prose-gray max-w-none
                  prose-p:my-1 prose-p:leading-relaxed
                  prose-headings:font-semibold prose-headings:mt-3 prose-headings:mb-1
                  prose-h1:text-base prose-h2:text-base prose-h3:text-sm
                  prose-ul:my-1 prose-ul:pl-5 prose-ol:my-1 prose-ol:pl-5
                  prose-li:my-0.5
                  prose-strong:font-semibold prose-strong:text-gray-900
                  prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:font-mono prose-code:before:content-none prose-code:after:content-none
                  prose-pre:bg-gray-100 prose-pre:rounded-lg prose-pre:p-3 prose-pre:text-xs prose-pre:overflow-x-auto
                  prose-blockquote:border-l-4 prose-blockquote:border-gray-200 prose-blockquote:pl-3 prose-blockquote:text-gray-500 prose-blockquote:not-italic
                  prose-table:text-xs prose-thead:bg-gray-50 prose-th:px-2 prose-th:py-1 prose-td:px-2 prose-td:py-1 prose-td:border prose-th:border"
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.content}
                  </ReactMarkdown>
                  {msg.streaming && (
                    <span className="inline-block w-1.5 h-4 bg-gray-400 ml-1 animate-pulse rounded align-middle" />
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {error && (
          <p className="text-center text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg px-4 py-2 max-w-sm mx-auto">
            {error}
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="bg-white border-t border-gray-200 px-4 py-3">
        {/* File chips */}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2 max-w-3xl mx-auto">
            {files.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 bg-blue-50 border border-blue-200 text-blue-700 text-xs px-2.5 py-1 rounded-full">
                <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
                <span className="max-w-[160px] truncate">{f.name}</span>
                <span className="text-blue-400">{formatBytes(f.size)}</span>
                <button type="button" onClick={() => removeFile(i)} className="ml-0.5 text-blue-400 hover:text-blue-700">×</button>
              </span>
            ))}
          </div>
        )}

        <form onSubmit={sendMessage} className="flex gap-2 max-w-3xl mx-auto items-center">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED}
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />

          {/* Attach button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading || files.length >= MAX_FILES}
            title={files.length >= MAX_FILES ? `Max ${MAX_FILES} files` : "Attach PDF, CSV, or TXT"}
            className="shrink-0 text-gray-400 hover:text-blue-600 disabled:opacity-30 p-2 rounded-lg hover:bg-blue-50 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>

          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
            placeholder="Ask an accounting or auditing question…"
            className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />

          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="shrink-0 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
          >
            {loading ? "…" : "Send"}
          </button>
        </form>

        <p className="text-center text-xs text-gray-300 mt-2">
          PDF · CSV · TXT — max {MAX_FILE_MB} MB · {MAX_FILES} files per message · context applies to this message only
        </p>
      </div>
    </div>
  );
}
