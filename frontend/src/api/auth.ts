// frontend/src/api/auth.ts
import { apiPost } from './client';
import { User } from './types';

export interface LoginResponse {
  token: string;
  user: User;
}

export function login(initData: string, startParam?: string): Promise<LoginResponse> {
  return apiPost<LoginResponse>('/auth/login', { initData, startParam });
}
