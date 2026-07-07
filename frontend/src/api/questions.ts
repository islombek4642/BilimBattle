// frontend/src/api/questions.ts
import { apiGet } from './client';
import { Category } from './types';

export function getCategories(): Promise<{ categories: Category[] }> {
  return apiGet<{ categories: Category[] }>('/categories');
}
