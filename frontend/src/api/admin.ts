// frontend/src/api/admin.ts
import { apiGet, apiPostForm } from './client';
import { AdminStats, QuestionImportResult } from './types';

export function getAdminStats(token: string): Promise<AdminStats> {
  return apiGet<AdminStats>('/admin/stats', token);
}

export function importQuestions(formData: FormData, token: string): Promise<QuestionImportResult> {
  return apiPostForm<QuestionImportResult>('/admin/questions/import', formData, token);
}
