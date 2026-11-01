import { startAuthentication, startRegistration } from '@simplewebauthn/browser';

let csrf = '';
export const setCsrf = (t: string) => (csrf = t);

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: any,
  ) {
    super(body?.error ?? `HTTP ${status}`);
  }
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      ...(method !== 'GET' ? { 'x-specage': '1', 'x-csrf-token': csrf } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, j);
  return j as T;
}

export async function loadMe(): Promise<{ label: string; expires: number; csrf: string } | null> {
  try {
    const me = await api('GET', '/api/me');
    setCsrf(me.csrf);
    return me;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}

/** Passkey assertion; used for login and for step-up before dispatch. */
export async function passkeyLogin(): Promise<void> {
  const opts = await api('POST', '/auth/login/options', {});
  const response = await startAuthentication({ optionsJSON: opts });
  const r = await api('POST', '/auth/login/verify', { response });
  setCsrf(r.csrf);
}

export async function passkeyRegister(label: string): Promise<void> {
  const opts = await api('POST', '/auth/register/options', {});
  const response = await startRegistration({ optionsJSON: opts });
  await api('POST', '/auth/register/verify', { response, label });
  await loadMe();
}
