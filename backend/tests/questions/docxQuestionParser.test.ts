import { parseQuestionsText } from '../../src/questions/docxQuestionParser';

describe('parseQuestionsText', () => {
  it('parses a single valid question block', () => {
    const result = parseQuestionsText(
      ['? Dunyodagi eng katta okean qaysi?', '= Atlantika', '+ Tinch okeani', '= Hind okeani', '= Shimoliy Muz okeani'].join(
        '\n'
      )
    );
    expect(result.errors).toEqual([]);
    expect(result.questions).toEqual([
      {
        text: 'Dunyodagi eng katta okean qaysi?',
        options: ['Atlantika', 'Tinch okeani', 'Hind okeani', 'Shimoliy Muz okeani'],
        correctIndex: 1,
      },
    ]);
  });

  it('parses multiple question blocks separated by a blank line', () => {
    const result = parseQuestionsText(
      ["? Savol 1?", "+ To'g'ri 1", '= Xato 1', '', '? Savol 2?', "+ To'g'ri 2", '= Xato 2'].join('\n')
    );
    expect(result.errors).toEqual([]);
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0].text).toBe('Savol 1?');
    expect(result.questions[1].text).toBe('Savol 2?');
  });

  it('reports an error for a question with no correct answer marked, without dropping other blocks', () => {
    const result = parseQuestionsText(
      ['? Savol 1?', '= Xato A', '= Xato B', '? Savol 2?', "+ To'g'ri", '= Xato'].join('\n')
    );
    expect(result.questions).toEqual([{ text: 'Savol 2?', options: ["To'g'ri", 'Xato'], correctIndex: 0 }]);
    expect(result.errors).toEqual([{ line: 1, message: "to'g'ri javob belgilanmagan" }]);
  });

  it('reports an error when a question has more than one correct answer marked', () => {
    const result = parseQuestionsText(['? Savol?', '+ Birinchi', '+ Ikkinchi', '= Xato'].join('\n'));
    expect(result.questions).toEqual([]);
    expect(result.errors).toEqual([{ line: 1, message: "bir nechta to'g'ri javob belgilangan" }]);
  });

  it('reports an error when a question has no wrong answers at all', () => {
    const result = parseQuestionsText(['? Savol?', "+ Yagona javob"].join('\n'));
    expect(result.questions).toEqual([]);
    expect(result.errors).toEqual([{ line: 1, message: "noto'g'ri javob yo'q" }]);
  });

  it('reports an error when the question text itself is empty', () => {
    const result = parseQuestionsText(['?', "+ To'g'ri", '= Xato'].join('\n'));
    expect(result.questions).toEqual([]);
    expect(result.errors).toEqual([{ line: 1, message: "savol matni bo'sh" }]);
  });

  it('trims leading/trailing whitespace on every line', () => {
    const result = parseQuestionsText(['  ? Savol?  ', "   + To'g'ri javob   ", '  = Xato javob  '].join('\n'));
    expect(result.questions).toEqual([{ text: 'Savol?', options: ["To'g'ri javob", 'Xato javob'], correctIndex: 0 }]);
  });

  it('ignores any text that appears before the first "?" line', () => {
    const result = parseQuestionsText(
      ['Bu preambula matni, savol emas.', '? Savol?', "+ To'g'ri", '= Xato'].join('\n')
    );
    expect(result.errors).toEqual([]);
    expect(result.questions).toHaveLength(1);
  });

  it('finalizes the last question block even with no trailing blank line at end of file', () => {
    const result = parseQuestionsText(['? Savol?', "+ To'g'ri", '= Xato'].join('\n'));
    expect(result.questions).toEqual([{ text: 'Savol?', options: ["To'g'ri", 'Xato'], correctIndex: 0 }]);
  });

  it('reports an error when the correct answer marker has empty text', () => {
    const result = parseQuestionsText(['? Savol?', '+', '= Xato'].join('\n'));
    expect(result.questions).toEqual([]);
    expect(result.errors).toEqual([{ line: 1, message: "javob matni bo'sh" }]);
  });

  it('reports an error when a wrong answer marker has empty text', () => {
    const result = parseQuestionsText(['? Savol?', "+ To'g'ri", '='].join('\n'));
    expect(result.questions).toEqual([]);
    expect(result.errors).toEqual([{ line: 1, message: "javob matni bo'sh" }]);
  });

  it('preserves the original document order of options, with correctIndex pointing at the "+"-marked one', () => {
    const result = parseQuestionsText(
      ['? Savol?', '= Birinchi (xato)', '= Ikkinchi (xato)', "+ Uchinchi (to'g'ri)", '= Tortinchi (xato)'].join('\n')
    );
    expect(result.questions[0].options).toEqual([
      'Birinchi (xato)',
      'Ikkinchi (xato)',
      "Uchinchi (to'g'ri)",
      'Tortinchi (xato)',
    ]);
    expect(result.questions[0].correctIndex).toBe(2);
  });
});
