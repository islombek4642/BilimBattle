import {
  tierForLevel,
  parseSimpleCsv,
  buildCefrWordLevels,
  joinCefrWithDefinitions,
  groupAndSortByTier,
  CefrVocabEntry,
} from '../../scripts/cefrVocabulary';
import { VocabEntry } from '../../scripts/importEnglishVocabulary';

describe('tierForLevel', () => {
  it('maps continuous scores to the nearest rounded tier, clamped to A1..C2', () => {
    expect(tierForLevel(1)).toBe('A1');
    expect(tierForLevel(1.4)).toBe('A1');
    expect(tierForLevel(1.5)).toBe('A2'); // rounds up at the midpoint
    expect(tierForLevel(6)).toBe('C2');
    expect(tierForLevel(0.2)).toBe('A1'); // clamped below 1
    expect(tierForLevel(7.9)).toBe('C2'); // clamped above 6
  });
});

describe('parseSimpleCsv', () => {
  it('parses quoted comma-separated rows into objects keyed by header', () => {
    const csv = '"word_id","word"\n"1","the"\n"2","of"\n';
    expect(parseSimpleCsv(csv)).toEqual([
      { word_id: '1', word: 'the' },
      { word_id: '2', word: 'of' },
    ]);
  });

  it('returns an empty array for a header-only (no data rows) input', () => {
    expect(parseSimpleCsv('"word_id","word"\n')).toEqual([]);
  });

  it('handles CRLF line endings without leaving a stray quote/carriage-return on the last column', () => {
    // Regression guard: backend/data/*.csv is pinned to LF via
    // .gitattributes, but this must not silently corrupt data if that ever
    // lapses (e.g. a future file added without the same gitattributes rule)
    // - word_pos.csv's LAST column is `level`, so a parser that only split
    // on '\n' would leave every row's level value as `6"\r` instead of `6`.
    const csv = '"word_id","level"\r\n"1","6"\r\n';
    expect(parseSimpleCsv(csv)).toEqual([{ word_id: '1', level: '6' }]);
  });
});

describe('buildCefrWordLevels', () => {
  const words = [
    { word_id: '1', word: 'run' },
    { word_id: '2', word: 'Perspicacious' },
  ];

  it('keeps the EASIEST (lowest-scoring) sense across multiple part-of-speech entries for the same word', () => {
    const wordPos = [
      { word_id: '1', level: '3.5', frequency_count: '100' }, // noun sense
      { word_id: '1', level: '1.2', frequency_count: '50' }, // verb sense - easier
    ];
    const result = buildCefrWordLevels(words, wordPos);
    expect(result.get('run')).toEqual({ level: 1.2, frequency: 50 });
  });

  it('keeps the higher frequency entry when two senses tie on level', () => {
    const wordPos = [
      { word_id: '1', level: '2', frequency_count: '10' },
      { word_id: '1', level: '2', frequency_count: '999' },
    ];
    const result = buildCefrWordLevels(words, wordPos);
    expect(result.get('run')).toEqual({ level: 2, frequency: 999 });
  });

  it('is case-insensitive when keying by word text', () => {
    const wordPos = [{ word_id: '2', level: '6', frequency_count: '5' }];
    const result = buildCefrWordLevels(words, wordPos);
    expect(result.has('perspicacious')).toBe(true);
  });

  it('skips word_pos rows referencing a word_id not present in the words list', () => {
    const wordPos = [{ word_id: '999', level: '1', frequency_count: '1' }];
    expect(buildCefrWordLevels(words, wordPos).size).toBe(0);
  });

  it('skips rows with a non-numeric level', () => {
    const wordPos = [{ word_id: '1', level: 'not-a-number', frequency_count: '1' }];
    expect(buildCefrWordLevels(words, wordPos).size).toBe(0);
  });
});

describe('joinCefrWithDefinitions', () => {
  it('keeps only CEFR words that also have a definition, case-insensitively, and drops the rest', () => {
    const cefrLevels = new Map([
      ['run', { level: 1.2, frequency: 50 }],
      ['perspicacious', { level: 6, frequency: 5 }],
      ['nodefinition', { level: 2, frequency: 1 }],
    ]);
    const definitionsPool: VocabEntry[] = [
      { term: 'Run', definitions: ['To move fast on foot'] },
      { term: 'Perspicacious', definitions: ['Having keen judgment'] },
    ];

    const joined = joinCefrWithDefinitions(cefrLevels, definitionsPool);
    expect(joined.length).toBe(2);
    expect(joined.find((e) => e.term === 'Run')).toMatchObject({
      cefrLevel: 1.2,
      cefrTier: 'A1',
      frequency: 50,
      definitions: ['To move fast on foot'],
    });
    expect(joined.find((e) => e.term === 'Perspicacious')?.cefrTier).toBe('C2');
  });
});

describe('groupAndSortByTier', () => {
  it('groups entries by rounded tier and sorts each tier by score ascending, then frequency descending', () => {
    const entries: CefrVocabEntry[] = [
      { term: 'b', definitions: ['B def'], cefrLevel: 1.4, cefrTier: 'A1', frequency: 10 },
      { term: 'a', definitions: ['A def'], cefrLevel: 1.1, cefrTier: 'A1', frequency: 5 },
      { term: 'c', definitions: ['C def'], cefrLevel: 1.1, cefrTier: 'A1', frequency: 500 }, // ties 'a' on score, wins on frequency
      { term: 'z', definitions: ['Z def'], cefrLevel: 6, cefrTier: 'C2', frequency: 1 },
    ];

    const grouped = groupAndSortByTier(entries);
    expect(grouped.get('A1')!.map((e) => e.term)).toEqual(['c', 'a', 'b']);
    expect(grouped.get('C2')!.map((e) => e.term)).toEqual(['z']);
    expect(grouped.get('B1')).toEqual([]); // present but empty - no B1 entries given
  });

  it('returns all 6 tiers as map keys, in A1->C2 order, even when some tiers have no entries', () => {
    const grouped = groupAndSortByTier([]);
    expect([...grouped.keys()]).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
  });
});
