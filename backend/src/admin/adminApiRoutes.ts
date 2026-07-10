import { Router, Response, Request, NextFunction } from 'express';
import multer from 'multer';
import mammoth from 'mammoth';
import { requireAuth, AuthenticatedRequest } from '../auth/authMiddleware';
import { env } from '../config/env';
import { getAdminSummary, getDailyStats, getUserList } from './statsQueries';
import { getCategoryByKey, createCategory, insertQuestions } from '../questions/questionRepository';
import { parseQuestionsText } from '../questions/docxQuestionParser';

export const adminApiRouter = Router();

// Same gate as scripts/healthcheck-alert.sh's Telegram DMs and the
// standalone /admin/stats HTML page - just checked against the
// already-authenticated session's telegramId instead of a separate
// password, so the dashboard can live inside the Mini App itself. Shared by
// every /admin/* route below (not just /admin/stats).
function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!env.adminTelegramId || req.telegramId !== env.adminTelegramId) {
    res.status(403).json({ error: "Ruxsat yo'q" });
    return;
  }
  next();
}

adminApiRouter.get(
  '/admin/stats',
  requireAuth,
  requireAdmin,
  async (_req: AuthenticatedRequest, res: Response) => {
    const [summary, daily, users] = await Promise.all([getAdminSummary(), getDailyStats(14), getUserList()]);
    res.json({ summary, daily, users });
  }
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Wraps multer's own error (e.g. file too large, or a field name other than
// "file") into the same { error: string } JSON shape every other route on
// this router uses, instead of falling through to Express's default HTML
// error page. LIMIT_FILE_SIZE gets its own specific message; every other
// MulterError code (e.g. LIMIT_UNEXPECTED_FILE from a wrong field name or a
// second attached file) gets a generic one instead of misreporting size.
function handleUpload(req: Request, res: Response, next: NextFunction): void {
  upload.single('file')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ error: 'Fayl hajmi juda katta (maksimal 5MB)' });
        return;
      }
      res.status(400).json({ error: 'Faylni yuklashda xatolik yuz berdi' });
      return;
    }
    if (err) {
      next(err);
      return;
    }
    next();
  });
}

adminApiRouter.post(
  '/admin/questions/import',
  requireAuth,
  requireAdmin,
  handleUpload,
  async (req: AuthenticatedRequest, res: Response) => {
    const file = req.file;
    if (!file || !file.originalname.toLowerCase().endsWith('.docx')) {
      res.status(400).json({ error: "Fayl .docx formatida bo'lishi kerak" });
      return;
    }

    const category = typeof req.body.category === 'string' ? req.body.category.trim() : '';
    const newCategoryLabel =
      typeof req.body.newCategoryLabel === 'string' ? req.body.newCategoryLabel.trim() : '';

    if ((!category && !newCategoryLabel) || (category && newCategoryLabel)) {
      res.status(400).json({ error: "category yoki newCategoryLabel'dan aynan bittasi berilishi kerak" });
      return;
    }

    const resolvedCategory = newCategoryLabel ? await createCategory(newCategoryLabel) : await getCategoryByKey(category);

    if (!resolvedCategory) {
      res.status(400).json({ error: 'Bunday turkum topilmadi' });
      return;
    }

    try {
      const { value: rawText } = await mammoth.extractRawText({ buffer: file.buffer });
      const { questions, errors } = parseQuestionsText(rawText);

      if (questions.length > 0) {
        await insertQuestions(resolvedCategory.key, questions);
      }

      res.json({ category: resolvedCategory, inserted: questions.length, errors });
    } catch {
      // A file that passes the .docx extension check but isn't actually a
      // valid docx (renamed .txt, truncated upload, corrupt zip) makes
      // mammoth throw - caught here so the response stays { error: string }
      // JSON like every other route, instead of falling through to
      // Express's default HTML error page.
      res.status(400).json({ error: "Fayl o'qib bo'lmadi - .docx formatida ekanligiga ishonch hosil qiling" });
    }
  }
);
