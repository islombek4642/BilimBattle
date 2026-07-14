// backend/scripts/cefrVocabulary.ts
import { promises as fs } from 'fs';
import { VocabEntry } from './importEnglishVocabulary';

export interface CefrWordInfo {
  level: number; // continuous CEFR difficulty score: 1.0 (easiest) .. 6.0 (hardest)
  frequency: number;
}

export type CefrTier = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

const TIER_LABELS: CefrTier[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export function tierForLevel(level: number): CefrTier {
  const rounded = Math.min(6, Math.max(1, Math.round(level)));
  return TIER_LABELS[rounded - 1];
}

// Minimal CSV parser matched to this specific dataset's shape (every field
// double-quoted, no embedded commas/quotes within a field, one row per
// line) - not a general-purpose CSV parser, don't reuse it for arbitrary
// CSV input.
export function parseSimpleCsv(content: string): Record<string, string>[] {
  // Splits on CRLF or LF, and trims the parts before checking for
  // surrounding quotes - defensive against Windows checkouts re-writing
  // line endings (backend/data/*.csv is pinned to `eol=lf` in
  // .gitattributes precisely so this never actually happens in practice,
  // but a parser that only handles LF would otherwise silently corrupt the
  // LAST column of every row - word_pos.csv's last column is `level`, the
  // exact field this whole feature's difficulty ordering depends on).
  const lines = content.split(/\r\n|\n/).filter((line) => line.length > 0);
  const stripQuotes = (value: string) => value.trim().replace(/^"|"$/g, '');
  const header = lines[0].split(',').map(stripQuotes);
  return lines.slice(1).map((line) => {
    const values = line.split(',').map(stripQuotes);
    const row: Record<string, string> = {};
    header.forEach((h, i) => {
      row[h] = values[i] ?? '';
    });
    return row;
  });
}

// For every distinct word (case-insensitive) across all its part-of-speech
// senses, keeps the EASIEST sense (lowest continuous CEFR score) - a word
// that's simple in its most common sense shouldn't be excluded from an
// early level just because a rarer sense of the same word scores harder
// elsewhere. Ties on score keep whichever entry has the higher frequency.
export function buildCefrWordLevels(
  words: Record<string, string>[],
  wordPos: Record<string, string>[]
): Map<string, CefrWordInfo> {
  const wordById = new Map(words.map((w) => [w.word_id, w.word]));
  const result = new Map<string, CefrWordInfo>();

  for (const wp of wordPos) {
    const term = wordById.get(wp.word_id);
    if (!term) continue;
    const level = parseFloat(wp.level);
    const frequency = parseInt(wp.frequency_count, 10) || 0;
    if (!Number.isFinite(level)) continue;

    const key = term.toLowerCase();
    const existing = result.get(key);
    if (!existing || level < existing.level) {
      result.set(key, { level, frequency });
    } else if (level === existing.level && frequency > existing.frequency) {
      existing.frequency = frequency;
    }
  }

  return result;
}

export interface CefrVocabEntry extends VocabEntry {
  cefrLevel: number;
  cefrTier: CefrTier;
  frequency: number;
}

// Joins the CEFR word->level map against the existing definitions pool
// (case-insensitive, exact word-text match - no lemmatization) and keeps
// only words present in both. CEFR words with no matching definition, and
// definitions-pool words with no CEFR entry, are both dropped - only the
// intersection ships (per the design spec's "full replace, CEFR-tagged
// only" decision).
export function joinCefrWithDefinitions(
  cefrLevels: Map<string, CefrWordInfo>,
  definitionsPool: VocabEntry[]
): CefrVocabEntry[] {
  const defsByTerm = new Map<string, VocabEntry>();
  for (const entry of definitionsPool) {
    const key = entry.term.toLowerCase();
    if (!defsByTerm.has(key)) defsByTerm.set(key, entry);
  }

  const joined: CefrVocabEntry[] = [];
  for (const [term, info] of cefrLevels.entries()) {
    const defEntry = defsByTerm.get(term);
    if (!defEntry) continue;
    joined.push({
      term: defEntry.term,
      definitions: defEntry.definitions,
      cefrLevel: info.level,
      cefrTier: tierForLevel(info.level),
      frequency: info.frequency,
    });
  }
  return joined;
}

// Groups by rounded tier (A1..C2) and sorts each tier's words by continuous
// CEFR score ascending (finer-grained than the 6 rounded tiers), then by
// frequency descending as a tie-break. Returns all 6 tiers as map keys (even
// empty ones) in A1->C2 order - this order is exactly the order
// importEnglishVocabulary.ts's main() must insert rows in, since
// questionRepository.ts's getQuestionsForLevel maps level->questions purely
// by `id` order and is NOT modified by this feature.
export function groupAndSortByTier(entries: CefrVocabEntry[]): Map<CefrTier, CefrVocabEntry[]> {
  const byTier = new Map<CefrTier, CefrVocabEntry[]>();
  for (const tier of TIER_LABELS) byTier.set(tier, []);
  for (const entry of entries) byTier.get(entry.cefrTier)!.push(entry);

  for (const tier of TIER_LABELS) {
    byTier.get(tier)!.sort((a, b) => a.cefrLevel - b.cefrLevel || b.frequency - a.frequency);
  }
  return byTier;
}

export async function loadCefrCsvFiles(wordsPath: string, wordPosPath: string): Promise<Map<string, CefrWordInfo>> {
  const [wordsContent, wordPosContent] = await Promise.all([
    fs.readFile(wordsPath, 'utf8'),
    fs.readFile(wordPosPath, 'utf8'),
  ]);
  return buildCefrWordLevels(parseSimpleCsv(wordsContent), parseSimpleCsv(wordPosContent));
}
