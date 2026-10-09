import type {
  Command,
  CommandBody,
  Detail,
  History,
  Me,
  Operator,
  Page,
  QueueItem,
  Receipt,
  Summary,
} from './types';
const base = import.meta.env.VITE_AUTOFLEX_API_URL || 'http://localhost:3001';
const tokenKey = 'af_support_access_token';
export const sessionChanged = 'af-support:session-changed';
export const session = {
  get: () => localStorage.getItem(tokenKey),
  set: (token: string) => {
    localStorage.setItem(tokenKey, token);
    window.dispatchEvent(new Event(sessionChanged));
  },
  clear: () => {
    localStorage.removeItem(tokenKey);
    window.dispatchEvent(new Event(sessionChanged));
  },
};
export class ApiError extends Error {
  status: number;
  code?: string;
  currentVersion?: number;
  constructor(status: number, message: string, code?: string, currentVersion?: number) {
    super(message);
    this.status = status;
    this.code = code;
    this.currentVersion = currentVersion;
  }
}
async function request<T>(path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  if (authenticated && session.get()) headers.set('Authorization', `Bearer ${session.get()}`);
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, 'Could not reach Autoflex. Check your connection.');
  }
  if (!response.ok) {
    if (response.status === 401 && authenticated) session.clear();
    const error = (await response.json().catch(() => ({}))) as {
      message?: string | string[];
      code?: string;
      currentVersion?: number;
    };
    throw new ApiError(
      response.status,
      Array.isArray(error.message) ? error.message.join(', ') : (error.message ?? 'Request failed'),
      error.code,
      error.currentVersion,
    );
  }
  return response.json() as Promise<T>;
}
export const api = {
  login: async (phone: string) => {
    const value = await request<{ accessToken: string }>(
      '/v1/dev/session',
      { method: 'POST', body: JSON.stringify({ phone, actor: 'support' }) },
      false,
    );
    return value.accessToken;
  },
  me: () => request<Me>('/v1/support/me'),
  agents: (manager: boolean) =>
    request<Operator[]>(`/v1/support/agents${manager ? '?includeInactive=true' : ''}`),
  queue: (query: string) => request<Page<QueueItem>>(`/v1/support/requests?${query}`),
  summary: (query: string) => request<Summary>(`/v1/support/requests/summary?${query}`),
  detail: (id: string) => request<Detail>(`/v1/support/requests/${id}`),
  history: (id: string, beforeVersion?: number) =>
    request<History>(
      `/v1/support/requests/${id}/events${beforeVersion ? `?beforeVersion=${beforeVersion}` : ''}`,
    ),
  command: (id: string, command: Command, body: CommandBody, version: number, key: string) =>
    request<Receipt>(`/v1/support/requests/${id}/${command}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'If-Match': String(version), 'Idempotency-Key': key },
    }),
};
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong';
