/**
 * Application shell: primary navigation, account menu, notifications.
 *
 * Navigation is the nine screens from the plan. Anything not yet built is
 * omitted rather than shown as a dead link.
 */

import { useState } from 'react';
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth.js';
import { initialsOf } from '../lib/format.js';
import { Alert, Button, Spinner, cx } from './ui.js';
import { NotificationBell } from './NotificationBell.js';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: '◎', end: true },
  { to: '/jobs', label: 'Jobs', icon: '≡' },
  { to: '/applications', label: 'Applications', icon: '▤' },
  { to: '/documents', label: 'Documents', icon: '✎' },
  { to: '/profile', label: 'Profile', icon: '◉' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

export function Shell() {
  const { user, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="min-h-full bg-slate-50 dark:bg-slate-950">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg dark:focus:bg-slate-900"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur dark:border-slate-800 dark:bg-slate-900/85">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <Link
            to="/"
            className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white"
          >
            <span
              aria-hidden="true"
              className="grid size-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white"
            >
              JH
            </span>
            <span className="hidden sm:inline">Job Hunter</span>
          </Link>

          <nav aria-label="Primary" className="ml-2 hidden items-center gap-1 md:flex">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cx(
                    'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            <NotificationBell />
            <div className="relative">
              <Link
                to="/settings"
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label={`Account settings for ${user?.displayName ?? 'you'}`}
              >
                <span className="grid size-7 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800 dark:bg-brand-900 dark:text-brand-100">
                  {initialsOf(user?.displayName ?? '?')}
                </span>
              </Link>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="hidden sm:inline-flex"
              onClick={() => void signOut()}
            >
              Sign out
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="md:hidden"
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav"
              onClick={() => setMobileOpen((open) => !open)}
            >
              <span aria-hidden="true">☰</span>
              <span className="sr-only">Menu</span>
            </Button>
          </div>
        </div>

        {mobileOpen ? (
          <nav
            id="mobile-nav"
            aria-label="Primary"
            className="border-t border-slate-200 md:hidden dark:border-slate-800"
          >
            <ul className="mx-auto max-w-7xl px-4 py-2 sm:px-6">
              {NAV_ITEMS.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      cx(
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium',
                        isActive
                          ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200'
                          : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800',
                      )
                    }
                  >
                    <span aria-hidden="true" className="w-4 text-center">
                      {item.icon}
                    </span>
                    {item.label}
                  </NavLink>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <span aria-hidden="true" className="w-4 text-center">
                    ⇥
                  </span>
                  Sign out
                </button>
              </li>
            </ul>
          </nav>
        ) : null}
      </header>

      <main
        id="main"
        key={location.pathname}
        className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8"
      >
        <Outlet />
      </main>

      <footer className="mx-auto max-w-7xl px-4 py-8 text-xs text-slate-500 sm:px-6 dark:text-slate-400">
        <p>
          Job Hunter prepares applications for you to review. It never submits an application and
          never bypasses a site&apos;s access controls.
        </p>
      </footer>
    </div>
  );
}

/** Full-page loading and error states used by the router boundary. */
export function FullPageLoading() {
  return (
    <div
      className="grid min-h-screen place-items-center bg-slate-50 dark:bg-slate-950"
      role="status"
    >
      <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
        <Spinner />
        Loading your workspace…
      </div>
    </div>
  );
}

export function FullPageError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 p-6 dark:bg-slate-950">
      <div className="w-full max-w-md space-y-4">
        <Alert tone="danger" title="We could not load your workspace">
          <p>{error.message}</p>
        </Alert>
        <Button onClick={onRetry}>Try again</Button>
      </div>
    </div>
  );
}
