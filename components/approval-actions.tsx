"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeCheck,
  Bookmark,
  CheckCircle2,
  Loader2,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from "lucide-react";

export function ApprovalActions({
  packageId,
  destinationUrl,
  status,
  approvalValid,
  approvalAt,
  applicationId,
  applicationStatus,
  resumeApproved,
  unsupportedCount,
}: {
  packageId: string;
  destinationUrl: string;
  status: string;
  approvalValid: boolean;
  approvalAt: string | null;
  applicationId: string | null;
  applicationStatus: string | null;
  resumeApproved: boolean;
  unsupportedCount: number;
}) {
  const router = useRouter();
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [handoffUrl, setHandoffUrl] = useState<string | null>(null);

  const call = async (url: string, body?: unknown) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error ?? "Request failed");
    return data;
  };

  const approve = async () => {
    setBusy("approve");
    setError(null);
    try {
      await call(`/api/application-packages/${packageId}/approve`, { confirm: true, method: "explicit_click" });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setBusy(null);
    }
  };

  const revoke = async () => {
    setBusy("revoke");
    setError(null);
    try {
      await call(`/api/application-packages/${packageId}/revoke`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke");
    } finally {
      setBusy(null);
    }
  };

  const saveForLater = async () => {
    setBusy("save");
    setError(null);
    try {
      await call(`/api/application-packages/${packageId}/save`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this package");
    } finally {
      setBusy(null);
    }
  };

  const reject = async () => {
    setBusy("reject");
    setError(null);
    try {
      await call(`/api/application-packages/${packageId}/reject`, {});
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reject this package");
    } finally {
      setBusy(null);
    }
  };

  const handoff = async () => {
    setBusy("handoff");
    setError(null);
    try {
      const data = (await call(`/api/application-packages/${packageId}/handoff`)) as { destinationUrl?: string };
      const url = data.destinationUrl ?? destinationUrl;
      setHandoffUrl(url);
      window.open(url, "_blank", "noopener,noreferrer");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the application page");
    } finally {
      setBusy(null);
    }
  };

  const recordSubmission = async () => {
    if (!applicationId) return;
    setBusy("submit");
    setError(null);
    try {
      await call(`/api/applications/${applicationId}/submit`, { confirmationReference: reference });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record submission");
    } finally {
      setBusy(null);
    }
  };

  const blocked = !resumeApproved || unsupportedCount > 0;
  let destinationHost = destinationUrl;
  try {
    destinationHost = new URL(destinationUrl).hostname.replace(/^www\./, "");
  } catch {
    destinationHost = destinationUrl;
  }

  return (
    <div className="space-y-3">
      {approvalValid ? (
        <div className="flex items-start gap-2 rounded-md bg-moss-50 px-3 py-2 text-xs text-moss-700">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
          <span>
            Approved {approvalAt ? new Date(approvalAt).toLocaleString("en-GB") : ""} for this exact package version. Any edit
            invalidates it.
          </span>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-md bg-[#fdf9ef] px-3 py-2 text-xs text-[#8a5a06]">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>No valid approval yet. Nothing can be submitted until you approve this specific package.</span>
        </div>
      )}

      {status === "REJECTED" ? (
        <p className="rounded-md bg-clay-50 px-3 py-2 text-[11px] text-clay-700">
          You rejected this package, so approval and handoff are closed. Assemble a new package from the job if you change your mind.
        </p>
      ) : null}
      {status === "SAVED" ? (
        <p className="rounded-md bg-[#fbfaf8] px-3 py-2 text-[11px] text-ink-soft">
          Saved for later. Nothing has been approved or sent; the package is kept exactly as you left it.
        </p>
      ) : null}

      {blocked ? (
        <p className="rounded-md bg-clay-50 px-3 py-2 text-[11px] text-clay-700">
          {unsupportedCount > 0
            ? "This package contains statements that are not backed by verified evidence. Resolve them in the resume workspace first."
            : "The tailored resume has not been approved by you yet. Approve it in the resume workspace first."}
        </p>
      ) : null}

      {!approvalValid ? (
        <>
          <label className="flex items-start gap-2 rounded-md border border-line px-3 py-2.5 text-xs leading-relaxed text-ink-soft">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              disabled={blocked}
            />
            <span>
              I have reviewed this exact resume, cover letter and destination. I approve preparing this application for{" "}
              <span className="font-semibold">{destinationHost}</span> and understand the
              approval expires if anything changes.
            </span>
          </label>
          <button
            type="button"
            className="btn-primary w-full"
            onClick={approve}
            disabled={!consent || blocked || busy === "approve"}
          >
            {busy === "approve" ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            Approve this package
          </button>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary btn-sm flex-1" onClick={saveForLater} disabled={busy === "save"}>
              {busy === "save" ? <Loader2 size={12} className="animate-spin" /> : <Bookmark size={12} />} Save for later
            </button>
            <button type="button" className="btn-ghost btn-sm flex-1 text-clay-700" onClick={reject} disabled={busy === "reject"}>
              {busy === "reject" ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />} Reject
            </button>
          </div>
          <p className="text-center text-[10px] leading-relaxed text-muted">
            Saving parks the draft without approving it. Rejecting closes this vacancy for you and revokes any earlier approval.
          </p>
        </>
      ) : (
        <>
          <button type="button" className="btn-primary w-full" onClick={handoff} disabled={busy === "handoff"}>
            {busy === "handoff" ? <Loader2 size={14} className="animate-spin" /> : <ArrowUpRight size={14} />}
            Open the official application page
          </button>
          <p className="text-center text-[10px] leading-relaxed text-muted">
            Manual handoff only. Job Hunter does not submit, and will never claim a submission it cannot confirm.
          </p>

          {handoffUrl ? (
            <div className="rounded-md border border-line bg-[#fbfaf8] px-3 py-2 text-[11px] text-ink-soft">
              Opened <span className="font-medium text-ink">{handoffUrl}</span>. Complete the form there, then record the
              confirmation reference below.
            </div>
          ) : null}

          {applicationId && applicationStatus !== "submitted" ? (
            <div className="rounded-md border border-line p-3">
              <label className="field-label" htmlFor="reference">
                Confirmation reference
              </label>
              <input
                id="reference"
                className="field text-xs"
                placeholder="e.g. application ID from the employer"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
              />
              <button
                type="button"
                className="btn-secondary mt-2 w-full"
                onClick={recordSubmission}
                disabled={reference.trim().length < 2 || busy === "submit"}
              >
                {busy === "submit" ? <Loader2 size={13} className="animate-spin" /> : <BadgeCheck size={13} />}
                I submitted it — record confirmation
              </button>
            </div>
          ) : applicationStatus === "submitted" ? (
            <div className="rounded-md bg-moss-50 px-3 py-2 text-[11px] text-moss-700">
              Recorded as submitted. Follow up in ten days if you have not heard back.
            </div>
          ) : null}

          <div className="flex gap-2">
            <button type="button" className="btn-danger flex-1 btn-sm" onClick={revoke} disabled={busy === "revoke"}>
              <RotateCcw size={12} /> Revoke approval
            </button>
            <a href={destinationUrl} target="_blank" rel="noopener noreferrer nofollow" className="btn-secondary flex-1 btn-sm">
              Open listing <ArrowUpRight size={12} />
            </a>
          </div>
        </>
      )}

      {status === "SUBMITTED" ? (
        <p className="rounded-md bg-moss-50 px-3 py-2 text-[11px] text-moss-700">
          This package is marked submitted with a recorded confirmation.
        </p>
      ) : null}
      {error ? <p className="rounded-md bg-clay-50 px-3 py-2 text-xs text-clay-700">{error}</p> : null}
    </div>
  );
}
