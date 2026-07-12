// frontend/src/utils/category.ts
// Mirrors the seeded rows of the backend's `categories` DB table
// (see backend/src/db/schema.sql). Keep in sync manually if a category is
// ever added/renamed there — this table has no compile-time or runtime link
// to the live GET /categories data.
const CATEGORY_LABELS: Record<string, string> = {
  umumiy_bilim: 'Umumiy bilim',
  sport_kino_musiqa: 'Sport/Kino/Musiqa',
  ingliz_tili: 'Ingliz tili',
};

export function categoryLabel(key: string): string {
  return CATEGORY_LABELS[key] ?? key;
}
