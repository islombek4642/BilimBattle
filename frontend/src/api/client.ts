// frontend/src/api/client.ts
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';

export function getAvatarUrl(telegramId: number): string {
  return `${API_URL}/users/${telegramId}/avatar`;
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface ErrorBody {
  error?: unknown;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...options, headers });
  } catch {
    throw new ApiError(0, 'Tarmoq xatosi');
  }

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    const errorBody = body as ErrorBody;
    const message = typeof errorBody.error === 'string' ? errorBody.error : "Noma'lum xatolik yuz berdi";
    throw new ApiError(res.status, message);
  }

  return body as T;
}

function authHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function apiGet<T>(path: string, token?: string): Promise<T> {
  return request<T>(path, { headers: authHeaders(token) });
}

export function apiPost<T>(path: string, data: unknown, token?: string): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: JSON.stringify(data),
    headers: authHeaders(token),
  });
}
