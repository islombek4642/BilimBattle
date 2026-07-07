const CATEGORY_LABELS: Record<string, string> = {
  umumiy_bilim: 'Umumiy bilim',
  sport_kino_musiqa: 'Sport/Kino/Musiqa',
};

export function categoryLabel(key: string): string {
  return CATEGORY_LABELS[key] ?? key;
}
