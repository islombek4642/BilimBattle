export interface ParsedQuestion {
  text: string;
  options: string[];
  correctIndex: number;
}

export interface ParseError {
  line: number;
  message: string;
}

export interface ParseResult {
  questions: ParsedQuestion[];
  errors: ParseError[];
}

interface RawEntry {
  isCorrect: boolean;
  text: string;
}

interface RawBlock {
  startLine: number;
  questionText: string | null;
  entries: RawEntry[];
}

// Parses the plain-text export of a .docx file authored with a simple line
// convention: "?" starts a new question, "+" marks its correct answer, "="
// marks a wrong answer. A bad block (missing/duplicate correct answer, no
// wrong answers, empty question or answer text) is reported as an error keyed
// to its starting line - it does NOT take down the rest of the file.
export function parseQuestionsText(rawText: string): ParseResult {
  const lines = rawText.split(/\r\n|\r|\n/);
  const questions: ParsedQuestion[] = [];
  const errors: ParseError[] = [];
  let current: RawBlock | null = null;

  function finalizeCurrent(): void {
    if (!current) return;
    const block = current;
    current = null;

    if (!block.questionText) {
      errors.push({ line: block.startLine, message: "savol matni bo'sh" });
      return;
    }

    const correctEntries = block.entries.filter((e) => e.isCorrect);
    const wrongEntries = block.entries.filter((e) => !e.isCorrect);

    if (correctEntries.length === 0) {
      errors.push({ line: block.startLine, message: "to'g'ri javob belgilanmagan" });
      return;
    }
    if (correctEntries.length > 1) {
      errors.push({ line: block.startLine, message: "bir nechta to'g'ri javob belgilangan" });
      return;
    }
    if (wrongEntries.length === 0) {
      errors.push({ line: block.startLine, message: "noto'g'ri javob yo'q" });
      return;
    }
    if (block.entries.some((e) => e.text === '')) {
      errors.push({ line: block.startLine, message: "javob matni bo'sh" });
      return;
    }

    questions.push({
      text: block.questionText,
      options: block.entries.map((e) => e.text),
      correctIndex: block.entries.findIndex((e) => e.isCorrect),
    });
  }

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (line === '') return;

    if (line.startsWith('?')) {
      finalizeCurrent();
      current = { startLine: lineNumber, questionText: line.slice(1).trim() || null, entries: [] };
      return;
    }

    if (!current) return; // Text before the first '?' line - ignored.

    if (line.startsWith('+')) {
      current.entries.push({ isCorrect: true, text: line.slice(1).trim() });
      return;
    }

    if (line.startsWith('=')) {
      current.entries.push({ isCorrect: false, text: line.slice(1).trim() });
      return;
    }

    // Any other line inside a block is ignored - it's not one of the three
    // recognized markers (?/+/=), so treating it as a parse error would be
    // too strict for a plain-text export out of Word (stray formatting
    // artifacts, empty bullet markers, etc).
  });

  finalizeCurrent();

  return { questions, errors };
}
