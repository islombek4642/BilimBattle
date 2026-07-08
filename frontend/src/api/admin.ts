// frontend/src/api/admin.ts
import { apiGet } from './client';
import { AdminStats } from './types';

export function getAdminStats(token: string): Promise<AdminStats> {
  return apiGet<AdminStats>('/admin/stats', token);
}
