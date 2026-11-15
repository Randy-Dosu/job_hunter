/**
 * Notification bell.
 *
 * Notifications are a convenience signal ("a scan finished", "a strong match
 * appeared"), never the only way to reach something — every notification links to
 * the screen that owns the data.
 */

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { request } from '../lib/api.js';
import { formatRelativeTime } from '../lib/format.js';
import type { NotificationItem } from '../lib/types.js';
import { useAsync } from '../lib/use-async.js';
import { Badge, Button, EmptyState, Skeleton, cx } from './ui.js';

interface NotificationListResponse {
  items: NotificationItem[];
  unreadCount: number;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { data, loading, error, reload, setData } = useAsync<NotificationListResponse>(
    (signal) => request<NotificationListResponse>('/notifications?limit=8', { signal }),
    [],
  );

  // Poll infrequently: this is a background summary, not a live feed.
  useEffect(() => {
    const timer = setInterval(() => reload(), 60_000);
    return () => clearInterval(timer);
  }, [reload]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const unread = data?.unreadCount ?? 0;

  const markAllRead = async (): Promise<void> => {
    await request('/notifications/read-all', { method: 'POST' }).catch(() => undefined);
    setData((current) =>
      current
        ? {
            unreadCount: 0,
            items: current.items.map((item) => ({
              ...item,
              readAt: item.readAt ?? new Date().toISOString(),
            })),
          }
        : current,
    );
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="true"
        className="relative grid size-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <span aria-hidden="true">🔔</span>
        <span className="sr-only">Notifications{unread > 0 ? `, ${unread} unread` : ''}</span>
        {unread > 0 ? (
          <span className="absolute top-1.5 right-1.5 grid min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-[10px] leading-4 font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
            role="presentation"
          />
          <div
            className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900"
            role="dialog"
            aria-label="Notifications"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Notifications
              </h2>
              {unread > 0 ? (
                <Button variant="ghost" size="sm" onClick={() => void markAllRead()}>
                  Mark all read
                </Button>
              ) : null}
            </div>

            <div className="max-h-96 overflow-y-auto">
              {loading && !data ? (
                <div className="space-y-2 p-3">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ) : error ? (
                <p className="p-4 text-sm text-rose-600 dark:text-rose-400">{error.message}</p>
              ) : (data?.items.length ?? 0) === 0 ? (
                <EmptyState
                  title="Nothing yet"
                  description="We will let you know when a scan finds new jobs."
                />
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data?.items.map((item) => (
                    <li key={item.id}>
                      <Link
                        to={item.link ?? '/'}
                        onClick={() => setOpen(false)}
                        className={cx(
                          'block px-4 py-3 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60',
                          !item.readAt && 'bg-brand-50/40 dark:bg-brand-900/20',
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-medium text-slate-900 dark:text-white">{item.title}</p>
                          {!item.readAt ? <Badge tone="brand">New</Badge> : null}
                        </div>
                        {item.body ? (
                          <p className="mt-0.5 line-clamp-2 text-slate-600 dark:text-slate-400">
                            {item.body}
                          </p>
                        ) : null}
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-500">
                          {formatRelativeTime(item.createdAt)}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
