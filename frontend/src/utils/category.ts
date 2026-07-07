// frontend/src/utils/category.ts
// Mirrors backend/src/questions/questionRepository.ts's CATEGORIES array.
// Keep in sync manually if a category is ever added/renamed there — this
// table has no compile-time or runtime link to the live GET /categories data.
const CATEGORY_LABELS: Record<string, string> = {
  umumiy_bilim: 'Umumiy bilim',
  sport_kino_musiqa: 'Sport/Kino/Musiqa',
};

export function categoryLabel(key: string): string {
  return CATEGORY_LABELS[key] ?? key;
}
