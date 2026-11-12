import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

export const VERDICT_COPY: Record<string, { label: string; tone: string; blurb: string }> = {
  strong: { label: "Strong match", tone: "text-moss-700", blurb: "Meets your must-haves with little missing" },
  possible: { label: "Possible match", tone: "text-[#8a5a06]", blurb: "Relevant, with gaps to weigh up" },
  low: { label: "Low match", tone: "text-muted", blurb: "Weak overlap with your verified profile" },
  excluded: { label: "Excluded", tone: "text-clay-700", blurb: "Blocked by one of your hard filters" },
};

const DOT: Record<string, string> = {
  strong: "bg-moss-600",
  possible: "bg-[#c58a12]",
  low: "bg-[#a3a8b0]",
  excluded: "bg-clay-500",
};

export function VerdictBadge({ verdict, withLabel = true }: { verdict: string; withLabel?: boolean }) {
  const copy = VERDICT_COPY[verdict] ?? VERDICT_COPY.low;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11.5px] font-medium ${copy.tone}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[verdict] ?? DOT.low}`} />
      {withLabel ? copy.label : null}
    </span>
  );
}

/** Otta-style match figure: big number, small label, thin track. */
export function MatchScore({
  score,
  verdict = "possible",
  size = "md",
}: {
  score: number;
  verdict?: string;
  size?: "sm" | "md" | "lg";
}) {
  const color = verdict === "strong" ? "#17694a" : verdict === "excluded" ? "#b5451f" : verdict === "possible" ? "#8a5a06" : "#6b7078";
  const dimensions = size === "lg" ? "h-[74px] w-[74px]" : size === "sm" ? "h-[46px] w-[46px]" : "h-[58px] w-[58px]";
  return (
    <div className={`flex ${dimensions} shrink-0 flex-col items-center justify-center rounded-md border border-line bg-[#fbfaf8]`}>
      <span className={`number font-semibold leading-none ${size === "lg" ? "text-[22px]" : size === "sm" ? "text-[15px]" : "text-[18px]"}`} style={{ color }}>
        {Math.round(score)}
        <span className="text-[10px] font-medium">%</span>
      </span>
      <span className="mt-1 text-[9px] font-medium uppercase tracking-[0.08em] text-muted">match</span>
    </div>
  );
}

export function VerdictMeter({ score, verdict }: { score: number; verdict: string }) {
  const color = verdict === "strong" ? "#17694a" : verdict === "excluded" ? "#b5451f" : verdict === "possible" ? "#c58a12" : "#a3a8b0";
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-[#eeeae4]">
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, score))}%`, background: color }} />
    </div>
  );
}

/** Company mark: deterministic muted tile with initials, in place of real logos. */
const MARKS = ["#e7e2d6", "#e3e7e0", "#e6e1e8", "#e9e3dc", "#dfe5e8", "#ece4d8"];
export function CompanyMark({ name, size = 40 }: { name: string; size?: number }) {
  const initials = name
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  let hash = 0;
  for (let index = 0; index < name.length; index++) hash = (hash * 31 + name.charCodeAt(index)) % 997;
  const background = MARKS[hash % MARKS.length];
  return (
    <span
      className="grid shrink-0 place-items-center rounded-[7px] border border-black/5 font-semibold text-ink/70"
      style={{ width: size, height: size, background, fontSize: size * 0.32 }}
      aria-hidden
    >
      {initials || "?"}
    </span>
  );
}

export function Callout({
  tone = "note",
  title,
  children,
  action,
}: {
  tone?: "note" | "warn" | "success" | "danger";
  title?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  const map = {
    note: "border-line bg-[#fbfaf8] text-ink-soft",
    warn: "border-[#f0e2c4] bg-[#fdf9ef] text-[#7a5710]",
    success: "border-moss-100 bg-moss-50 text-moss-700",
    danger: "border-clay-100 bg-clay-50 text-clay-700",
  }[tone];
  return (
    <div className={`rounded-md border px-3 py-2.5 text-[12.5px] leading-relaxed ${map}`}>
      {title ? <p className="font-semibold">{title}</p> : null}
      <div className={title ? "mt-0.5" : ""}>{children}</div>
      {action ? <div className="mt-1.5">{action}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  secondary,
  icon,
}: {
  title: string;
  description: string;
  action?: { href: string; label: string };
  secondary?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-dashed border-line-strong bg-[#fbfaf8] px-6 py-12 text-center">
      {icon ? <div className="mx-auto mb-2.5 grid h-9 w-9 place-items-center rounded-full bg-[#f1eee9] text-muted">{icon}</div> : null}
      <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-[12.5px] leading-relaxed text-muted">{description}</p>
      {action ? (
        <Link href={action.href} className="btn-secondary mt-4">
          {action.label}
        </Link>
      ) : null}
      {secondary ? <div className="mt-3">{secondary}</div> : null}
    </div>
  );
}

export function SourceLink({ href, label, muted = false }: { href: string; label: string; muted?: boolean }) {
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
      className={`inline-flex items-center gap-1 text-[11.5px] ${muted ? "text-muted hover:text-ink hover:underline" : "text-ink-soft hover:text-ink hover:underline"}`}
    >
      {label}
      {host ? <span className="text-[11px] text-muted">· {host}</span> : null}
      <ArrowUpRight size={11} />
    </a>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "moss" | "clay";
}) {
  return (
    <div className="border-l border-line px-4 py-1 first:border-l-0 first:pl-0">
      <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted">{label}</p>
      <p
        className={`number mt-1 text-[20px] font-semibold leading-none ${
          tone === "moss" ? "text-moss-700" : tone === "clay" ? "text-clay-700" : "text-ink"
        }`}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-[11px] text-muted">{hint}</p> : null}
    </div>
  );
}

export function formatDate(value: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", opts);
}

export function Salary({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted">Salary not disclosed</span>;
  return <span className="font-medium text-ink">{value}</span>;
}
