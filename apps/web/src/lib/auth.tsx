/**
 * Session context.
 *
 * The session cookie is HttpOnly, so the only source of truth is `GET /auth/me`.
 * This provider exposes an explicit status machine so the router can distinguish
 * "still checking" from "signed out" and never flashes the wrong screen.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, request } from './api.js';
import type { MeResponse, User } from './types.js';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'error';

interface AuthContextValue {
  status: AuthStatus;
  user: User | undefined;
  me: MeResponse | undefined;
  error: Error | undefined;
  signIn: (input: { email: string; password: string }) => Promise<void>;
  signUp: (input: {
    email: string;
    password: string;
    displayName: string;
    acceptedTerms: true;
    timeZone: string;
  }) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [me, setMe] = useState<MeResponse | undefined>(undefined);
  const [error, setError] = useState<Error | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const result = await request<MeResponse>('/auth/me');
      setMe(result);
      setStatus('authenticated');
      setError(undefined);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setMe(undefined);
        setStatus('anonymous');
        setError(undefined);
        return;
      }
      // A network failure is not the same as being signed out: say so instead of
      // silently redirecting the user to the sign-in screen.
      setError(caught instanceof Error ? caught : new Error('Unknown error'));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const signIn = useCallback<AuthContextValue['signIn']>(
    async (input) => {
      const result = await request<{ user: User }>('/auth/signin', { method: 'POST', body: input });
      setMe((current) => ({
        user: result.user,
        consents: current?.consents ?? [],
        consentVersions: current?.consentVersions ?? {},
      }));
      setStatus('authenticated');
      await load();
    },
    [load],
  );

  const signUp = useCallback<AuthContextValue['signUp']>(
    async (input) => {
      const result = await request<{ user: User }>('/auth/signup', { method: 'POST', body: input });
      setMe({
        user: result.user,
        consents: [],
        consentVersions: {},
      });
      setStatus('authenticated');
      await load();
    },
    [load],
  );

  const signOut = useCallback(async () => {
    try {
      await request<void>('/auth/signout', { method: 'POST' });
    } finally {
      setMe(undefined);
      setStatus('anonymous');
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user: me?.user,
      me,
      error,
      signIn,
      signUp,
      signOut,
      refresh: load,
    }),
    [status, me, error, signIn, signUp, signOut, load],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
