import { pickRandomDistractors, buildQuestionRow, shuffleInPlace, VocabEntry } from '../../scripts/importEnglishVocabulary';

// A constant rng (e.g. `() => 0.4`) can never satisfy pickRandomDistractors'
// while loop once it needs more than one distinct index - it would keep
// re-rolling the exact same idx forever and hang the test. This cycles
// through every index of a 4-entry pool in a fixed order, repeating - for
// ANY single excluded selfIndex in range, one full cycle always yields
// exactly 3 fresh, distinct, non-self indexes (1 skip + 3 picks), so it
// terminates regardless of which entry is "self". Extra calls beyond a full
// cycle (used by buildQuestionRow's shuffle step) just keep cycling, which
// is fine there since that's a fixed-length for loop, not a while loop
// waiting on distinct values.
function sequenceRng(sequence: number[]): () => number {
  let call = 0;
  return () => sequence[call++ % sequence.length];
}

describe('pickRandomDistractors', () => {
  const pool: VocabEntry[] = [
    { term: 'alpha', definitions: ['Alpha def'] },
    { term: 'beta', definitions: ['Beta def'] },
    { term: 'gamma', definitions: ['Gamma def'] },
    { term: 'delta', definitions: ['Delta def'] },
  ];

  it('returns the requested count of entries, never including the excluded index', () => {
    // idx sequence (pool.length = 4): 0 (= selfIndex, skipped), then 1, 2, 3.
    const rng = sequenceRng([0, 0.25, 0.5, 0.75]);
    const picked = pickRandomDistractors(pool, 0, 3, rng);
    expect(picked.length).toBe(3);
    expect(picked.some((p) => p.term === 'alpha')).toBe(false);
  });

  it('never returns the same entry twice, even when the rng repeats an already-picked index', () => {
    // idx sequence (pool.length = 4): 1, 1 (dup of the first - must be
    // skipped and re-rolled), 2, 3. Index 0 (self) never comes up here, so
    // this exercises the pickedIndexes.has(idx) branch specifically, not
    // the idx === selfIndex branch already covered by the test above.
    const rng = sequenceRng([0.25, 0.25, 0.5, 0.75]);
    const picked = pickRandomDistractors(pool, 0, 3, rng);
    const terms = picked.map((p) => p.term);
    expect(new Set(terms).size).toBe(3);
  });

  it('throws rather than looping forever when the pool is too small for the requested count', () => {
    const tinyPool: VocabEntry[] = [
      { term: 'only', definitions: ['Only def'] },
      { term: 'other', definitions: ['Other def'] },
    ];
    expect(() => pickRandomDistractors(tinyPool, 0, 3)).toThrow();
  });
});

describe('buildQuestionRow', () => {
  const pool: VocabEntry[] = [
    { term: 'alpha', definitions: ['Alpha primary meaning', 'Alpha secondary meaning'] },
    { term: 'beta', definitions: ['Beta primary meaning'] },
    { term: 'gamma', definitions: ['Gamma primary meaning'] },
    { term: 'delta', definitions: ['Delta primary meaning'] },
  ];

  it('uses the term as question text, the first definition as the correct option, and marks correctIndex accurately', () => {
    const row = buildQuestionRow(pool[0], 0, pool, sequenceRng([0, 0.25, 0.5, 0.75]));
    expect(row.text).toBe('alpha');
    expect(row.options.length).toBe(4);
    // Shuffling can move the correct option to any slot - correctIndex is
    // computed AFTER shuffling, so this holds regardless of where it lands.
    expect(row.options[row.correctIndex]).toBe('Alpha primary meaning');
  });

  it('carries the remaining definitions (beyond the first) as extraDefinitions', () => {
    const row = buildQuestionRow(pool[0], 0, pool, sequenceRng([0, 0.25, 0.5, 0.75]));
    expect(row.extraDefinitions).toEqual(['Alpha secondary meaning']);
  });

  it('leaves extraDefinitions empty for a word with only one definition', () => {
    const row = buildQuestionRow(pool[1], 1, pool, sequenceRng([0, 0.25, 0.5, 0.75]));
    expect(row.extraDefinitions).toEqual([]);
  });

  it('never includes the target word itself among the distractor options', () => {
    const row = buildQuestionRow(pool[0], 0, pool, sequenceRng([0, 0.25, 0.5, 0.75]));
    const occurrences = row.options.filter((o) => o === 'Alpha primary meaning').length;
    expect(occurrences).toBe(1); // would be 2 if alpha were also picked as its own distractor
  });

  it('throws if entryIndex does not actually point at entry within pool (caller bug guard)', () => {
    expect(() => buildQuestionRow(pool[0], 1, pool, sequenceRng([0, 0.25, 0.5, 0.75]))).toThrow();
  });
});

describe('shuffleInPlace', () => {
  it('reorders the array (not a no-op) for a non-trivial input and a real rng', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const original = [...arr];
    shuffleInPlace(arr);
    expect(arr).not.toEqual(original); // astronomically unlikely to coincidentally match with Math.random
    expect(arr.length).toBe(original.length);
    expect([...arr].sort((a, b) => a - b)).toEqual(original); // same elements, no loss/duplication
  });

  it('is a no-op-safe operation for an empty or single-element array', () => {
    const empty: number[] = [];
    expect(() => shuffleInPlace(empty)).not.toThrow();
    expect(empty).toEqual([]);

    const single = [42];
    shuffleInPlace(single);
    expect(single).toEqual([42]);
  });
});
