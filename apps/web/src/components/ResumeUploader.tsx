/**
 * CV uploader.
 *
 * Client-side checks are a courtesy (instant feedback); the server re-validates
 * everything, including magic bytes. Files are sent as multipart directly to the
 * API and stored privately — there is no public URL.
 */

import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { ApiError, request } from '../lib/api.js';
import type { ResumeRecord } from '../lib/types.js';
import { Alert, Button, Spinner, cx } from './ui.js';

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ['.pdf', '.docx'];

export function ResumeUploader({
  onUploaded,
  compact = false,
}: {
  onUploaded: (resume: ResumeRecord) => void;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [success, setSuccess] = useState<string | undefined>();

  const validate = (file: File): string | undefined => {
    const name = file.name.toLowerCase();
    if (!ACCEPTED.some((extension) => name.endsWith(extension))) {
      return 'Upload a PDF or DOCX file. Older .doc files are not supported.';
    }
    if (file.size === 0) return 'That file is empty.';
    if (file.size > MAX_BYTES) return 'That file is larger than 5 MB.';
    return undefined;
  };

  const upload = async (file: File): Promise<void> => {
    const problem = validate(file);
    if (problem) {
      setError(problem);
      setSuccess(undefined);
      return;
    }

    setUploading(true);
    setError(undefined);
    setSuccess(undefined);

    const form = new FormData();
    form.append('file', file);

    try {
      const result = await request<{ resume: ResumeRecord }>('/resumes', {
        method: 'POST',
        raw: form,
      });
      setSuccess(`${file.name} uploaded.`);
      onUploaded(result.resume);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Upload failed. Try again.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const onChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file) void upload(file);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void upload(file);
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cx(
          'flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed text-center transition-colors',
          compact ? 'px-4 py-6' : 'px-6 py-10',
          dragging
            ? 'border-brand-500 bg-brand-50 dark:bg-brand-950'
            : 'border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60',
        )}
      >
        {uploading ? (
          <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <Spinner className="size-4" />
            Uploading and reading your CV…
          </div>
        ) : (
          <>
            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
              Drop your CV here, or choose a file
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">PDF or DOCX, up to 5 MB</p>
            <Button
              variant="secondary"
              size={compact ? 'sm' : 'md'}
              onClick={() => inputRef.current?.click()}
              className="mt-1"
            >
              Choose file
            </Button>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="sr-only"
          onChange={onChange}
          aria-label="Upload your CV"
        />
      </div>

      {error ? (
        <Alert tone="danger" title="Upload failed">
          {error}
        </Alert>
      ) : null}
      {success ? <Alert tone="success">{success}</Alert> : null}
    </div>
  );
}
