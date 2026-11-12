"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

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

export function DemoLoginButton({ className = "btn-primary w-full", label = "Open the demo account" }: { className?: string; label?: string }) {
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
        {loading || pending ? <Loader2 size={13} className="animate-spin" /> : null}
        {label}
      </button>
      {error ? <p className="mt-2 text-[11px] text-clay-700">{error}</p> : null}
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
    <div>
      <div className="mb-4 flex gap-5 border-b border-line">
        {(["login", "signup"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              setMode(option);
              setError(null);
            }}
            className={`-mb-px border-b-2 pb-2 text-[13px] font-medium transition-colors ${
              mode === option ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {option === "login" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="space-y-3">
        {mode === "signup" ? (
          <div>
            <label className="field-label" htmlFor="name">
              Full name
            </label>
            <input id="name" className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ama Serwaa" autoComplete="name" />
          </div>
        ) : null}
        <div>
          <label className="field-label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="field"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </div>
        <div>
          <label className="field-label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className="field"
            type="password"
            required
            minLength={mode === "signup" ? 8 : 1}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={mode === "signup" ? "At least 8 characters" : "••••••••"}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
          />
        </div>
        {error ? <p className="rounded-md border border-clay-100 bg-clay-50 px-2.5 py-1.5 text-[11.5px] text-clay-700">{error}</p> : null}
        <button className="btn-primary w-full" type="submit" disabled={loading}>
          {loading ? <Loader2 size={13} className="animate-spin" /> : null}
          {mode === "login" ? "Sign in" : "Create account"}
        </button>
      </form>

      <div className="my-4 flex items-center gap-3 text-[11px] text-muted">
        <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
      </div>
      <DemoLoginButton className="btn-secondary w-full" label="Continue with the demo account" />
      <p className="mt-2 text-center text-[11px] text-muted">demo@jobhunter.app · hunter1234</p>
    </div>
  );
}
