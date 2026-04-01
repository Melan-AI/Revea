"use client";

import { useMemo, useState } from "react";

type ContractAnalysis = {
  summary: string;
  safetyScore: number;
  risks: string[];
  permissions: string[];
  redFlags: string[];
  assumptions: string[];
  confidence: "low" | "medium" | "high";
};

type ContractMeta = {
  address: string;
  name: string | null;
  compilerVersion: string | null;
  sourceLanguage: string | null;
  files: string[];
};

type AnalysisResponse = {
  analysis: ContractAnalysis;
  contract: ContractMeta;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const DEFAULT_MESSAGES: ChatMessage[] = [
  {
    role: "assistant",
    content:
      "Ask anything about the contract. I can explain permissions, risks, or what the code appears to do.",
  },
];

const scoreLabel = (score: number) => {
  if (score >= 80) return "Looks safer than average";
  if (score >= 60) return "Moderate risk";
  if (score >= 40) return "High risk signals";
  return "Critical concerns";
};

export default function Home() {
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(DEFAULT_MESSAGES);

  const scoreTone = useMemo(() => {
    const score = analysis?.analysis.safetyScore ?? 0;
    if (score >= 80) return "text-emerald-300";
    if (score >= 60) return "text-amber-200";
    if (score >= 40) return "text-orange-300";
    return "text-rose-300";
  }, [analysis]);

  const scoreRing = useMemo(() => {
    const score = analysis?.analysis.safetyScore ?? 0;
    const circumference = 2 * Math.PI * 36;
    const offset = circumference - (score / 100) * circumference;
    return { circumference, offset };
  }, [analysis]);

  const runAnalysis = async () => {
    setError(null);
    setAnalysis(null);
    setMessages(DEFAULT_MESSAGES);
    if (!address.trim()) {
      setError("Please enter a contract address.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: address.trim() }),
      });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload?.error ?? "Failed to analyze contract.");
      }
      const payload = (await response.json()) as AnalysisResponse;
      setAnalysis(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const sendChat = async () => {
    if (!analysis) {
      setError("Analyze a contract before asking questions.");
      return;
    }
    if (!chatInput.trim()) return;
    setError(null);
    const question = chatInput.trim();
    setChatInput("");
    setChatLoading(true);
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, analysis }),
      });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload?.error ?? "Failed to get an answer.");
      }
      const payload = (await response.json()) as { answer: string };
      setMessages((prev) => [...prev, { role: "assistant", content: payload.answer }]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            err instanceof Error
              ? err.message
              : "Something went wrong while answering.",
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div className="min-h-screen px-6 pb-16 pt-12 text-white sm:px-10 lg:px-16">
      <header className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.3em] text-white/70">
          Revea
        </div>
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-6">
            <h1 className="text-4xl font-semibold leading-tight sm:text-5xl">
              Understand any Ethereum contract in plain English.
            </h1>
            <p className="max-w-xl text-lg text-white/70">
              Paste a contract address to pull verified source code, analyze risk
              signals, and get a clear safety score. Ask follow-up questions without
              wading through the code.
            </p>
          </div>
          <div className="flex flex-col justify-between gap-6 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-[var(--shadow)]">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-white/50">
                How it works
              </p>
              <ol className="mt-4 space-y-3 text-sm text-white/80">
                <li>1. Fetch verified Solidity source.</li>
                <li>2. AI summarizes behavior + risks.</li>
                <li>3. Get a safety score and chat.</li>
              </ol>
            </div>
            <div className="rounded-2xl bg-black/40 p-4 text-xs text-white/60">
              Built for non-technical reviewers. Always verify with trusted audits
              before moving funds.
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto mt-12 flex w-full max-w-6xl flex-col gap-10">
        <section className="rounded-3xl border border-white/10 bg-[var(--card)] p-6 shadow-[var(--shadow)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold">Contract analysis</h2>
              <p className="text-sm text-white/60">
                Mainnet address only. We only analyze verified source on Etherscan.
              </p>
            </div>
            <div className="flex w-full flex-col gap-3 lg:w-auto lg:flex-row">
              <input
                className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white/90 outline-none placeholder:text-white/40 lg:min-w-[320px]"
                placeholder="0x... contract address"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
              />
              <button
                onClick={runAnalysis}
                disabled={loading}
                className="rounded-2xl bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] px-6 py-3 text-sm font-semibold text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "Analyzing..." : "Analyze"}
              </button>
            </div>
          </div>
          {error ? (
            <div className="mt-4 rounded-2xl border border-rose-400/40 bg-rose-500/10 p-4 text-sm text-rose-100">
              {error}
            </div>
          ) : null}
        </section>

        {analysis ? (
          <section className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
            <div className="flex flex-col gap-6">
              <div className="rounded-3xl border border-white/10 bg-[var(--card)] p-6 shadow-[var(--shadow)]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-white/50">
                      Safety Score
                    </p>
                    <p className={`mt-2 text-3xl font-semibold ${scoreTone}`}>
                      {analysis.analysis.safetyScore}/100
                    </p>
                    <p className="mt-2 text-sm text-white/70">
                      {scoreLabel(analysis.analysis.safetyScore)}
                    </p>
                  </div>
                  <div className="relative flex h-28 w-28 items-center justify-center">
                    <svg className="h-full w-full -rotate-90" viewBox="0 0 80 80">
                      <circle
                        cx="40"
                        cy="40"
                        r="36"
                        stroke="rgba(255,255,255,0.1)"
                        strokeWidth="8"
                        fill="none"
                      />
                      <circle
                        cx="40"
                        cy="40"
                        r="36"
                        stroke="var(--accent)"
                        strokeWidth="8"
                        strokeLinecap="round"
                        fill="none"
                        strokeDasharray={scoreRing.circumference}
                        strokeDashoffset={scoreRing.offset}
                      />
                    </svg>
                    <span className="absolute text-sm text-white/70">
                      {analysis.analysis.confidence} confidence
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-[var(--card)] p-6 shadow-[var(--shadow)]">
                <p className="text-xs uppercase tracking-[0.2em] text-white/50">
                  Contract details
                </p>
                <div className="mt-4 space-y-3 text-sm text-white/80">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="text-white/50">Address</span>
                    <span className="font-mono text-xs">{analysis.contract.address}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-white/50">Name</span>
                    <span>{analysis.contract.name ?? "Unknown"}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-white/50">Compiler</span>
                    <span>{analysis.contract.compilerVersion ?? "Unknown"}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-white/50">Language</span>
                    <span>{analysis.contract.sourceLanguage ?? "Unknown"}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 text-white/50">
                    Files: {analysis.contract.files.join(", ")}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-6">
              <div className="rounded-3xl border border-white/10 bg-[var(--card)] p-6 shadow-[var(--shadow)]">
                <p className="text-xs uppercase tracking-[0.2em] text-white/50">
                  Plain-English summary
                </p>
                <p className="mt-4 text-sm leading-relaxed text-white/80">
                  {analysis.analysis.summary}
                </p>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-3xl border border-white/10 bg-[var(--card)] p-6 shadow-[var(--shadow)]">
                  <p className="text-xs uppercase tracking-[0.2em] text-white/50">
                    Key permissions
                  </p>
                  <ul className="mt-4 space-y-2 text-sm text-white/80">
                    {analysis.analysis.permissions.map((item) => (
                      <li key={item} className="rounded-xl bg-black/40 px-3 py-2">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-3xl border border-white/10 bg-[var(--card)] p-6 shadow-[var(--shadow)]">
                  <p className="text-xs uppercase tracking-[0.2em] text-white/50">
                    Risk signals
                  </p>
                  <ul className="mt-4 space-y-2 text-sm text-white/80">
                    {analysis.analysis.risks.map((item) => (
                      <li key={item} className="rounded-xl bg-black/40 px-3 py-2">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-[var(--card)] p-6 shadow-[var(--shadow)]">
                <p className="text-xs uppercase tracking-[0.2em] text-white/50">
                  Red flags & assumptions
                </p>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl bg-black/40 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-white/40">
                      Red flags
                    </p>
                    <ul className="mt-3 space-y-2 text-sm text-white/80">
                      {analysis.analysis.redFlags.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-2xl bg-black/40 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-white/40">
                      Assumptions
                    </p>
                    <ul className="mt-3 space-y-2 text-sm text-white/80">
                      {analysis.analysis.assumptions.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : (
          <section className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-8 text-center text-sm text-white/60">
            Run an analysis to unlock the full report and AI assistant.
          </section>
        )}

        <section className="rounded-3xl border border-white/10 bg-[var(--card)] p-6 shadow-[var(--shadow)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold">Contract Q&A</h2>
              <p className="text-sm text-white/60">
                Uses the analysis context to answer fast, focused questions.
              </p>
            </div>
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="flex min-h-[320px] flex-col gap-4 rounded-2xl border border-white/10 bg-black/40 p-4">
              {messages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    message.role === "user"
                      ? "ml-auto bg-white/15 text-white"
                      : "bg-white/5 text-white/80"
                  }`}
                >
                  {message.content}
                </div>
              ))}
              {chatLoading ? (
                <div className="w-fit rounded-2xl bg-white/5 px-4 py-2 text-xs text-white/60">
                  Thinking...
                </div>
              ) : null}
            </div>
            <div className="flex flex-col gap-4">
              <textarea
                className="min-h-[140px] rounded-2xl border border-white/10 bg-black/40 p-4 text-sm text-white/90 outline-none placeholder:text-white/40"
                placeholder="Is the owner able to drain funds? Are there upgrade keys?"
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
              />
              <button
                onClick={sendChat}
                disabled={chatLoading || !analysis}
                className="rounded-2xl bg-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
              {chatLoading ? "Answering..." : "Ask Revea"}
              </button>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-xs text-white/60">
                Responses are limited to the fetched code and analysis context.
                This is not an audit.
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
