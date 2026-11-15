/**
 * Router.
 *
 * Screens are code-split so the initial bundle stays small. Authenticated
 * screens sit behind <RequireAuth>, which never renders protected content while
 * the session state is still unknown.
 */

import { Suspense, lazy, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { FullPageError, FullPageLoading, Shell } from './components/Shell.js';
import { useAuth } from './lib/auth.js';

const DashboardPage = lazy(() => import('./pages/DashboardPage.js'));
const JobsPage = lazy(() => import('./pages/JobsPage.js'));
const JobDetailPage = lazy(() => import('./pages/JobDetailPage.js'));
const StudioPage = lazy(() => import('./pages/StudioPage.js'));
const ApplicationsPage = lazy(() => import('./pages/ApplicationsPage.js'));
const ProfilePage = lazy(() => import('./pages/ProfilePage.js'));
const SettingsPage = lazy(() => import('./pages/SettingsPage.js'));
const OnboardingPage = lazy(() => import('./pages/OnboardingPage.js'));
const AuthPage = lazy(() => import('./pages/AuthPage.js'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage.js'));

function RequireAuth({ children }: { children: ReactNode }) {
  const { status, error, refresh } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullPageLoading />;
  if (status === 'error') {
    return (
      <FullPageError error={error ?? new Error('Unknown error')} onRetry={() => void refresh()} />
    );
  }
  if (status === 'anonymous') {
    return <Navigate to="/signin" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}

/** Redirect signed-in users away from the auth screens. */
function PublicOnly({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') return <FullPageLoading />;
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Suspense fallback={<FullPageLoading />}>
      <Routes>
        <Route
          path="/signin"
          element={
            <PublicOnly>
              <AuthPage mode="signin" />
            </PublicOnly>
          }
        />
        <Route
          path="/signup"
          element={
            <PublicOnly>
              <AuthPage mode="signup" />
            </PublicOnly>
          }
        />
        <Route
          path="/onboarding"
          element={
            <RequireAuth>
              <OnboardingPage />
            </RequireAuth>
          }
        />
        <Route
          element={
            <RequireAuth>
              <Shell />
            </RequireAuth>
          }
        >
          <Route path="/" element={<DashboardPage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/jobs/:jobId" element={<JobDetailPage />} />
          <Route path="/jobs/:jobId/studio" element={<StudioPage />} />
          <Route path="/documents" element={<StudioPage />} />
          <Route path="/documents/:documentId" element={<StudioPage />} />
          <Route path="/applications" element={<ApplicationsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
