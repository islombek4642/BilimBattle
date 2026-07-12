// backend/scripts/importEnglishVocabulary.ts
export interface VocabEntry {
  term: string;
  definitions: string[];
}

export interface BuiltQuestionRow {
  text: string;
  options: string[];
  correctIndex: number;
  extraDefinitions: string[];
}

// Picks `count` distinct entries from `pool`, never including `selfIndex`.
// Index-based (not term-based) exclusion so this stays O(count) per call
// regardless of pool size - the real dataset has 466k entries, and this
// function runs once per entry, so an O(pool.length) filter/scan per call
// would make the whole import script quadratic (466k^2) and impractically
// slow. Picking random indexes directly and re-rolling on a rare collision
// keeps each call cheap no matter how large the pool is.
export function pickRandomDistractors(
  pool: VocabEntry[],
  selfIndex: number,
  count: number,
  rng: () => number = Math.random
): VocabEntry[] {
  if (pool.length <= count) {
    throw new Error(`pool of ${pool.length} entries is too small to pick ${count} distractors from`);
  }
  const pickedIndexes = new Set<number>();
  const picked: VocabEntry[] = [];
  while (picked.length < count) {
    const idx = Math.floor(rng() * pool.length);
    if (idx === selfIndex || pickedIndexes.has(idx)) continue;
    pickedIndexes.add(idx);
    picked.push(pool[idx]);
  }
  return picked;
}

// Builds one 4-option question row for `entry`. `entryIndex` is entry's own
// position in `pool` (see pickRandomDistractors above for why this is
// index-based). Uses a Fisher-Yates shuffle tagged with which option is
// correct, rather than shuffling plain strings and then searching for the
// correct one afterwards with indexOf - two different words could
// coincidentally share identical definition text, which would make indexOf
// find the wrong (or merely "a", ambiguous) occurrence.
export function buildQuestionRow(
  entry: VocabEntry,
  entryIndex: number,
  pool: VocabEntry[],
  rng: () => number = Math.random
): BuiltQuestionRow {
  if (pool[entryIndex] !== entry) {
    throw new Error(`entryIndex ${entryIndex} does not match the given entry in pool - caller bug`);
  }
  const distractors = pickRandomDistractors(pool, entryIndex, 3, rng);
  const options = [
    { text: entry.definitions[0], isCorrect: true },
    ...distractors.map((d) => ({ text: d.definitions[0], isCorrect: false })),
  ];
  for (let i = options.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return {
    text: entry.term,
    options: options.map((o) => o.text),
    correctIndex: options.findIndex((o) => o.isCorrect),
    extraDefinitions: entry.definitions.slice(1),
  };
}
