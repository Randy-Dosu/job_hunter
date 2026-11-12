"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; redirect?: string };
  if (!res.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
  return data;
}

export function DemoLoginButton({ className = "btn-primary w-full", label = "Explore the demo account" }: { className?: string; label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await post("/api/auth/demo", {});
      startTransition(() => router.push(data.redirect ?? "/dashboard"));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setLoading(false);
    }
  };

  return (
    <div className="w-full">
      <button type="button" onClick={run} disabled={loading || pending} className={className}>
        {loading || pending ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
        {label}
        {!loading && !pending ? <ArrowRight size={15} /> : null}
      </button>
      {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}

export function LoginForm({ mode: initialMode = "login" }: { mode?: "login" | "signup" }) {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data = await post(mode === "login" ? "/api/auth/login" : "/api/auth/signup", { name, email, password });
      router.push(data.redirect ?? "/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setLoading(false);
    }
  };

  return (
    <div className="card card-pad">
      <div className="mb-5 flex rounded-lg bg-slate-100 p-1">
        {(["login", "signup"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              setMode(option);
              setError(null);
            }}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              mode === option ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
            }`}
          >
            {option === "login" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="space-y-3.5">
        {mode === "signup" ? (
          <div>
            <label className="label" htmlFor="name">
              Your name
            </label>
            <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ama Serwaa" autoComplete="name" />
          </div>
        ) : null}
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="input"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className="input"
            type="password"
            required
            minLength={mode === "signup" ? 8 : 1}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "signup" ? "At least 8 characters" : "••••••••"}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
          />
        </div>
        {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
        <button className="btn-primary w-full" type="submit" disabled={loading}>
          {loading ? <Loader2 size={15} className="animate-spin" /> : null}
          {mode === "login" ? "Sign in" : "Create my account"}
        </button>
      </form>

      <div className="my-4 flex items-center gap-3 text-[11px] uppercase tracking-wide text-slate-400">
        <span className="h-px flex-1 bg-slate-200" /> or <span className="h-px flex-1 bg-slate-200" />
      </div>
      <DemoLoginButton className="btn-secondary w-full" label="Open the seeded demo account" />
      <p className="mt-3 text-center text-[11px] text-slate-400">Demo: demo@jobhunter.app · hunter1234</p>
    </div>
  );
}
