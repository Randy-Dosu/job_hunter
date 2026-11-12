import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Info, ShieldAlert } from "lucide-react";

export const VERDICT_COPY: Record<string, { label: string; className: string; blurb: string }> = {
  strong: { label: "Strong match", className: "badge-strong", blurb: "Meets your must-haves with little evidence missing" },
  possible: { label: "Possible match", className: "badge-possible", blurb: "Relevant, but there are gaps to weigh up" },
  low: { label: "Low match", className: "badge-low", blurb: "Weak overlap with your verified profile" },
  excluded: { label: "Excluded", className: "badge-excluded", blurb: "Blocked by one of your hard filters" },
};

export function VerdictBadge({ verdict }: { verdict: string }) {
  const copy = VERDICT_COPY[verdict] ?? VERDICT_COPY.low;
  return <span className={copy.className}>{copy.label}</span>;
}

export function ScoreRing({
  score,
  confidence,
  size = 64,
  verdict = "possible",
}: {
  score: number;
  confidence: number;
  size?: number;
  verdict?: string;
}) {
  const stroke = size >= 56 ? 6 : 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = (Math.max(0, Math.min(100, score)) / 100) * circumference;
  const color =
    verdict === "strong" ? "#059669" : verdict === "excluded" ? "#e11d48" : verdict === "possible" ? "#d97706" : "#64748b";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={`Match ${score}/100 · confidence ${confidence}%`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#eef1f6" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span className="text-sm font-semibold text-slate-900" style={{ fontSize: size >= 56 ? 15 : 12 }}>
          {score}
        </span>
      </div>
    </div>
  );
}

export function ConfidenceBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(100, value)}%` }} />
      </div>
      <span className="text-[11px] font-medium text-slate-500">{value}% data confidence</span>
    </div>
  );
}

export function Callout({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn" | "success" | "danger";
  title?: string;
  children: React.ReactNode;
}) {
  const map = {
    info: { cls: "border-slate-200 bg-slate-50 text-slate-700", Icon: Info },
    warn: { cls: "border-amber-200 bg-amber-50 text-amber-900", Icon: AlertTriangle },
    success: { cls: "border-emerald-200 bg-emerald-50 text-emerald-900", Icon: CheckCircle2 },
    danger: { cls: "border-rose-200 bg-rose-50 text-rose-900", Icon: ShieldAlert },
  }[tone];
  return (
    <div className={`flex gap-2.5 rounded-xl border px-4 py-3 text-sm ${map.cls}`}>
      <map.Icon size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className={title ? "mt-0.5 opacity-90" : ""}>{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: { href: string; label: string };
  icon?: React.ReactNode;
}) {
  return (
    <div className="card grid place-items-center px-6 py-14 text-center">
      {icon ? <div className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-slate-500">{icon}</div> : null}
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>
      {action ? (
        <Link href={action.href} className="btn-primary mt-4">
          {action.label} <ArrowUpRight size={14} />
        </Link>
      ) : null}
    </div>
  );
}

export function SourceLink({ href, label = "Original listing" }: { href: string; label?: string }) {
  let host = "";
  try {
    host = new URL(href).hostname.replace(/^www\./, "");
  } catch {
    host = "";
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
    >
      {label}
      {host ? <span className="text-slate-400">· {host}</span> : null}
      <ArrowUpRight size={11} />
    </a>
  );
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="card px-4 py-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight text-slate-900">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p> : null}
    </div>
  );
}

export function formatDate(value: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", opts);
}
