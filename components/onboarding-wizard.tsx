"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Check,
  FileUp,
  Loader2,
  Plus,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

type Fact = {
  factType: string;
  title: string;
  organization: string;
  location: string;
  startDate: string | null;
  endDate: string | null;
  bullets: string[];
  skills: string[];
  state: string;
  confidence: number;
  verificationStatus: string;
};

type Props = {
  name: string;
  initialProfile: {
    headline: string;
    summary: string;
    location: string;
    workAuthorization: string;
    needsSponsorship: boolean;
    timezone: string;
  };
  initialPrefs: {
    roleTitles: string[];
    countries: string[];
    remoteRegions: string[];
    remotePreference: string;
    seniority: string[];
    jobTypes: string[];
    industries: string[];
    salaryFloor: number | null;
    currency: string;
    excludedEmployers: string[];
    excludedKeywords: string[];
    excludedLocations: string[];
    searchTime: string;
    timezone: string;
    daysOfWeek: number[];
    notifyEmail: boolean;
    notifyInApp: boolean;
    scheduleEnabled: boolean;
    enabledSourceIds: string[];
  };
  sources: { id: string; name: string; slug: string; accessMethod: string; enabled: boolean }[];
  baseResumeText: string | null;
  startingStep?: number;
};

const STEPS = ["Profile", "Market", "Resume", "Schedule"];
const SENIORITY = [
  { value: "internship", label: "Internship" },
  { value: "entry", label: "Entry level" },
  { value: "junior", label: "Junior" },
  { value: "mid", label: "Mid-level" },
  { value: "senior", label: "Senior" },
  { value: "lead", label: "Lead" },
];
const JOB_TYPES = ["full-time", "part-time", "contract", "internship"];
const DAYS = ["S", "M", "T", "W", "T", "F", "S"];

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Request failed");
  return data;
}

function ChipInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const value = draft.trim();
    if (!value || values.includes(value)) return;
    onChange([...values, value]);
    setDraft("");
  };
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {values.map((value) => (
          <span key={value} className="inline-flex items-center gap-1 rounded-full bg-[#f1eee9] px-2.5 py-1 text-xs font-medium text-ink ring-1 ring-line">
            {value}
            <button type="button" onClick={() => onChange(values.filter((item) => item !== value))} aria-label={`Remove ${value}`}>
              <X size={11} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className="field"
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              add();
            }
          }}
        />
        <button type="button" onClick={add} className="btn-secondary shrink-0 px-3">
          <Plus size={14} /> Add
        </button>
      </div>
    </div>
  );
}

export function OnboardingWizard(props: Props) {
  const router = useRouter();
  const [step, setStep] = useState(props.startingStep ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [profile, setProfile] = useState(props.initialProfile);
  const [prefs, setPrefs] = useState(props.initialPrefs);

  const [resumeText, setResumeText] = useState(props.baseResumeText ?? "");
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [imported, setImported] = useState(false);

  const togglePref = (key: "seniority" | "jobTypes" | "industries", value: string) => {
    setPrefs((current) => {
      const list = current[key];
      return { ...current, [key]: list.includes(value) ? list.filter((item) => item !== value) : [...list, value] };
    });
  };

  const saveProfileAndPrefs = async () => {
    await send("/api/profile", "PUT", {
      headline: profile.headline,
      summary: profile.summary,
      location: profile.location,
      workAuthorization: profile.workAuthorization,
      needsSponsorship: profile.needsSponsorship,
      timezone: profile.timezone,
      preferences: {
        roleTitles: prefs.roleTitles,
        countries: prefs.countries,
        remoteRegions: prefs.remoteRegions,
        remotePreference: prefs.remotePreference,
        seniority: prefs.seniority,
        jobTypes: prefs.jobTypes,
        industries: prefs.industries,
        salaryFloor: prefs.salaryFloor,
        currency: prefs.currency,
        excludedEmployers: prefs.excludedEmployers,
        excludedKeywords: prefs.excludedKeywords,
        excludedLocations: prefs.excludedLocations,
        searchTime: prefs.searchTime,
        timezone: prefs.timezone,
        daysOfWeek: prefs.daysOfWeek,
        notifyEmail: prefs.notifyEmail,
        notifyInApp: prefs.notifyInApp,
        scheduleEnabled: prefs.scheduleEnabled,
        enabledSourceIds: prefs.enabledSourceIds,
      },
    });
  };

  const next = async () => {
    setError(null);
    setSaving(true);
    try {
      if (step === 0 || step === 1) await saveProfileAndPrefs();
      if (step === 3) {
        await saveProfileAndPrefs();
        await send("/api/search-runs", "POST", { trigger: "manual" });
        router.push("/dashboard");
        router.refresh();
        return;
      }
      setStep((current) => Math.min(current + 1, STEPS.length - 1));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const handleFile = async (file: File) => {
    setParsing(true);
    setParseError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/resumes", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not read that file");
      setDocumentId(data.documentId);
      setResumeText(data.parsed.text);
      setFacts(
        (data.parsed.facts as Fact[]).map((fact) => ({
          ...fact,
          verificationStatus: fact.confidence >= 0.8 ? "verified" : "unverified",
        })),
      );
      if (!profile.summary && data.parsed.summary) setProfile((current) => ({ ...current, summary: data.parsed.summary }));
      if (!profile.headline && data.parsed.headline) setProfile((current) => ({ ...current, headline: data.parsed.headline }));
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setParsing(false);
    }
  };

  const parsePasted = async () => {
    if (resumeText.trim().length < 80) {
      setParseError("Paste a bit more of your resume (at least a few lines).");
      return;
    }
    setParsing(true);
    setParseError(null);
    try {
      const res = await fetch("/api/resumes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: resumeText, filename: "pasted-resume.txt" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not parse that text");
      setDocumentId(data.documentId);
      setFacts(
        (data.parsed.facts as Fact[]).map((fact) => ({
          ...fact,
          verificationStatus: fact.confidence >= 0.8 ? "verified" : "unverified",
        })),
      );
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Parse failed");
    } finally {
      setParsing(false);
    }
  };

  const saveFacts = async () => {
    if (!documentId || !facts.length) return;
    setSaving(true);
    setError(null);
    try {
      await send("/api/evidence", "POST", { documentId, items: facts });
      setImported(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save facts");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-ink text-white">
          <Sparkles size={17} />
        </span>
        <div>
          <p className="text-sm font-semibold text-ink">Set up your job hunt</p>
          <p className="text-[11px] text-muted">Step {step + 1} of {STEPS.length} · takes about four minutes</p>
        </div>
      </div>

      <ol className="mb-6 flex items-center gap-1.5">
        {STEPS.map((label, index) => (
          <li key={label} className="flex flex-1 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setStep(index)}
              className={`flex items-center gap-2 rounded-md px-2 py-1 text-xs font-semibold transition ${
                index === step ? "bg-[#f1eee9] text-ink" : index < step ? "text-moss-700" : "text-muted"
              }`}
            >
              <span
                className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${
                  index === step ? "bg-ink text-white" : index < step ? "bg-moss-600 text-white" : "bg-[#e8e4dd] text-muted"
                }`}
              >
                {index < step ? <Check size={11} /> : index + 1}
              </span>
              <span className="hidden sm:inline">{label}</span>
            </button>
            {index < STEPS.length - 1 ? <span className="h-px flex-1 bg-[#e8e4dd]" /> : null}
          </li>
        ))}
      </ol>

      <div className="card card-pad">
        {step === 0 ? (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-ink">Hi {props.name.split(" ")[0]} — what should we call you?</h2>
              <p className="mt-1 text-sm text-muted">These details appear on generated resumes. You can change them any time.</p>
            </div>
            <div>
              <label className="field-label" htmlFor="headline">Professional headline</label>
              <input
                id="headline"
                className="field"
                value={profile.headline}
                onChange={(event) => setProfile({ ...profile, headline: event.target.value })}
                placeholder="Junior software developer — React, TypeScript, Node.js"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="summary">Short summary</label>
              <textarea
                id="summary"
                className="field min-h-28"
                value={profile.summary}
                onChange={(event) => setProfile({ ...profile, summary: event.target.value })}
                placeholder="Two or three sentences about your background, what you build and what you are looking for."
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="field-label" htmlFor="location">Location</label>
                <input
                  id="location"
                  className="field"
                  value={profile.location}
                  onChange={(event) => setProfile({ ...profile, location: event.target.value })}
                  placeholder="Kumasi, Ghana"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="timezone">Time zone</label>
                <input
                  id="timezone"
                  className="field"
                  value={profile.timezone}
                  onChange={(event) => setProfile({ ...profile, timezone: event.target.value })}
                  placeholder="Africa/Accra"
                />
              </div>
            </div>
            <div>
              <label className="field-label" htmlFor="auth">Work authorization</label>
              <input
                id="auth"
                className="field"
                value={profile.workAuthorization}
                onChange={(event) => setProfile({ ...profile, workAuthorization: event.target.value })}
                placeholder="Ghana — authorised to work remotely; needs sponsorship for on-site roles abroad"
              />
            </div>
            <label className="flex items-start gap-2.5 rounded-md border border-line px-3 py-2.5 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={profile.needsSponsorship}
                onChange={(event) => setProfile({ ...profile, needsSponsorship: event.target.checked })}
              />
              <span>
                <span className="font-medium text-ink">I need visa sponsorship</span>
                <span className="block text-xs text-muted">Roles that explicitly cannot sponsor will be filtered out.</span>
              </span>
            </label>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-ink">Define your market</h2>
              <p className="mt-1 text-sm text-muted">We only search what you allow here, and hard filters always win over a high score.</p>
            </div>
            <div>
              <label className="field-label">Target job titles</label>
              <ChipInput
                values={prefs.roleTitles}
                onChange={(roleTitles) => setPrefs({ ...prefs, roleTitles })}
                placeholder="Frontend Developer, Software Engineer…"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="field-label">Countries you can work from</label>
                <ChipInput values={prefs.countries} onChange={(countries) => setPrefs({ ...prefs, countries })} placeholder="Ghana, Worldwide…" />
              </div>
              <div>
                <label className="field-label">Remote eligibility regions</label>
                <ChipInput
                  values={prefs.remoteRegions}
                  onChange={(remoteRegions) => setPrefs({ ...prefs, remoteRegions })}
                  placeholder="Worldwide, Europe…"
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="field-label" htmlFor="remote">Work arrangement</label>
                <select
                  id="remote"
                  className="field"
                  value={prefs.remotePreference}
                  onChange={(event) => setPrefs({ ...prefs, remotePreference: event.target.value })}
                >
                  <option value="remote">Remote only</option>
                  <option value="hybrid">Remote or hybrid</option>
                  <option value="onsite">On-site welcome</option>
                  <option value="any">Any arrangement</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="field-label" htmlFor="salary">Salary floor</label>
                  <input
                    id="salary"
                    type="number"
                    min={0}
                    className="field"
                    value={prefs.salaryFloor ?? ""}
                    onChange={(event) => setPrefs({ ...prefs, salaryFloor: event.target.value ? Number(event.target.value) : null })}
                    placeholder="24000"
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="currency">Currency</label>
                  <input
                    id="currency"
                    className="field"
                    value={prefs.currency}
                    onChange={(event) => setPrefs({ ...prefs, currency: event.target.value.toUpperCase() })}
                  />
                </div>
              </div>
            </div>
            <div>
              <label className="field-label">Seniority levels in scope</label>
              <div className="flex flex-wrap gap-1.5">
                {SENIORITY.map((level) => (
                  <button
                    key={level.value}
                    type="button"
                    onClick={() => togglePref("seniority", level.value)}
                    className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition ${
                      prefs.seniority.includes(level.value)
                        ? "bg-ink text-white ring-ink"
                        : "bg-surface text-ink-soft ring-line hover:bg-[#fbfaf8]"
                    }`}
                  >
                    {level.label}
                  </button>
                ))}
                <span className="self-center text-[11px] text-muted">empty = every level</span>
              </div>
            </div>
            <div>
              <label className="field-label">Job types</label>
              <div className="flex flex-wrap gap-1.5">
                {JOB_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => togglePref("jobTypes", type)}
                    className={`rounded-full px-3 py-1 text-xs font-medium capitalize ring-1 transition ${
                      prefs.jobTypes.includes(type) ? "bg-ink text-white ring-ink" : "bg-surface text-ink-soft ring-line"
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="field-label">Excluded keywords</label>
              <ChipInput
                values={prefs.excludedKeywords}
                onChange={(excludedKeywords) => setPrefs({ ...prefs, excludedKeywords })}
                placeholder="unpaid, commission only…"
              />
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-ink">Import your base resume</h2>
              <p className="mt-1 text-sm text-muted">
                TXT, Markdown, PDF or DOCX. We extract sections and ask you to confirm each fact before it can be used.
              </p>
            </div>

            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed border-line-strong bg-[#fbfaf8] px-4 py-8 text-center transition hover:border-[#bdb8b0] hover:bg-[#f1eee9]/40">
              <span className="grid h-10 w-10 place-items-center rounded-[10px] bg-surface text-ink shadow-sm">
                {parsing ? <Loader2 size={18} className="animate-spin" /> : <FileUp size={18} />}
              </span>
              <span className="text-sm font-medium text-ink">Choose a resume file</span>
              <span className="text-xs text-muted">or paste the text below</span>
              <input
                type="file"
                accept=".txt,.md,.pdf,.docx,text/plain,application/pdf"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) handleFile(file);
                }}
              />
            </label>

            <textarea
              className="field min-h-36 font-mono text-[12px]"
              value={resumeText}
              onChange={(event) => setResumeText(event.target.value)}
              placeholder="Paste your resume text here…"
            />
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={parsePasted} className="btn-secondary" disabled={parsing}>
                {parsing ? <Loader2 size={14} className="animate-spin" /> : null} Extract facts from text
              </button>
              {facts.length ? (
                <button type="button" onClick={() => setFacts([])} className="btn-ghost">
                  Clear extracted facts
                </button>
              ) : null}
            </div>

            {parseError ? <p className="rounded-md bg-clay-50 px-3 py-2 text-xs text-clay-700">{parseError}</p> : null}

            {facts.length ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="section-title">
                    {facts.length} facts detected · review before saving
                  </p>
                  <span className="chip-moss">
                    <ShieldCheck size={11} /> unverified needs your confirmation
                  </span>
                </div>
                <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
                  {facts.map((fact, index) => (
                    <div key={`${fact.factType}-${index}`} className="rounded-[10px] border border-line bg-surface px-3 py-2.5">
                      <div className="flex flex-wrap items-start gap-2">
                        <span className="chip capitalize">{fact.factType}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-ink">
                            {fact.title || "(untitled)"}
                            {fact.organization ? <span className="text-muted"> · {fact.organization}</span> : null}
                          </p>
                          <p className="text-[11px] text-muted">
                            {[fact.startDate, fact.endDate ?? (fact.startDate ? "Present" : null)].filter(Boolean).join(" – ")}
                            {fact.bullets.length ? ` · ${fact.bullets.length} bullet${fact.bullets.length === 1 ? "" : "s"}` : ""}
                          </p>
                          {fact.bullets.length ? (
                            <ul className="mt-1 space-y-0.5">
                              {fact.bullets.slice(0, 3).map((bullet, bulletIndex) => (
                                <li key={bulletIndex} className="truncate text-[11px] text-muted">
                                  • {bullet}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          <label className="flex items-center gap-1.5 text-[11px] font-medium text-ink-soft">
                            <input
                              type="checkbox"
                              checked={fact.verificationStatus === "verified"}
                              onChange={(event) =>
                                setFacts((current) =>
                                  current.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, verificationStatus: event.target.checked ? "verified" : "unverified" } : item,
                                  ),
                                )
                              }
                            />
                            Verified
                          </label>
                          {fact.factType === "skill" ? (
                            <select
                              className="rounded border border-line px-1.5 py-1 text-[11px]"
                              value={fact.state}
                              onChange={(event) =>
                                setFacts((current) =>
                                  current.map((item, itemIndex) => (itemIndex === index ? { ...item, state: event.target.value } : item)),
                                )
                              }
                            >
                              <option value="professional">Professional</option>
                              <option value="learning">Learning only</option>
                              <option value="none">Not evidenced</option>
                            </select>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="btn-primary" onClick={saveFacts} disabled={saving || imported}>
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <BadgeCheck size={14} />}
                    {imported ? "Facts saved" : "Save confirmed facts"}
                  </button>
                  <span className="text-[11px] text-muted">
                    Only verified facts can appear in a tailored resume. Learning skills are labelled, never upgraded.
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-ink">When should we search?</h2>
              <p className="mt-1 text-sm text-muted">Schedules are timezone-aware and idempotent — one run per window.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="field-label" htmlFor="time">Daily search time</label>
                <input
                  id="time"
                  type="time"
                  className="field"
                  value={prefs.searchTime}
                  onChange={(event) => setPrefs({ ...prefs, searchTime: event.target.value })}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="tzone">Time zone</label>
                <input
                  id="tzone"
                  className="field"
                  value={prefs.timezone}
                  onChange={(event) => setPrefs({ ...prefs, timezone: event.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="field-label">Days of the week</label>
              <div className="flex gap-1.5">
                {DAYS.map((day, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() =>
                      setPrefs({
                        ...prefs,
                        daysOfWeek: prefs.daysOfWeek.includes(index)
                          ? prefs.daysOfWeek.filter((value) => value !== index)
                          : [...prefs.daysOfWeek, index].sort(),
                      })
                    }
                    className={`grid h-8 w-8 place-items-center rounded-md text-xs font-semibold ring-1 transition ${
                      prefs.daysOfWeek.includes(index) ? "bg-ink text-white ring-ink" : "bg-surface text-muted ring-line"
                    }`}
                    aria-label={`Day ${index + 1}`}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="field-label">Approved sources</label>
              <div className="space-y-1.5">
                {props.sources.map((source) => (
                  <label key={source.id} className="flex items-start gap-2 rounded-md border border-line px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={prefs.enabledSourceIds.includes(source.id)}
                      onChange={(event) =>
                        setPrefs({
                          ...prefs,
                          enabledSourceIds: event.target.checked
                            ? [...prefs.enabledSourceIds, source.id]
                            : prefs.enabledSourceIds.filter((id) => id !== source.id),
                        })
                      }
                    />
                    <span>
                      <span className="font-medium text-ink">{source.name}</span>
                      <span className="block text-[11px] text-muted">{source.accessMethod} · terms reviewed</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={prefs.notifyInApp}
                  onChange={(event) => setPrefs({ ...prefs, notifyInApp: event.target.checked })}
                />
                In-app digest
              </label>
              <label className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={prefs.notifyEmail}
                  onChange={(event) => setPrefs({ ...prefs, notifyEmail: event.target.checked })}
                />
                Email digest (opt-in)
              </label>
            </div>
            <label className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={prefs.scheduleEnabled}
                onChange={(event) => setPrefs({ ...prefs, scheduleEnabled: event.target.checked })}
              />
              Keep daily automation enabled
            </label>
          </div>
        ) : null}

        {error ? <p className="mt-4 rounded-md bg-clay-50 px-3 py-2 text-xs text-clay-700">{error}</p> : null}

        <div className="mt-6 flex items-center justify-between border-t border-line pt-4">
          <button type="button" className="btn-ghost" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0}>
            <ArrowLeft size={14} /> Back
          </button>
          <button type="button" className="btn-primary" onClick={next} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            {step === STEPS.length - 1 ? "Finish and run first search" : "Continue"}
            {step === STEPS.length - 1 ? <Sparkles size={14} /> : <ArrowRight size={14} />}
          </button>
        </div>
      </div>

      <p className="mt-4 text-center text-[11px] text-muted">
        You can pause automation, change sources, or delete everything from Settings at any time.
      </p>
    </div>
  );
}
