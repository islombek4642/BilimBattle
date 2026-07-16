import { Router, Response, Request, NextFunction } from 'express';
import multer from 'multer';
import mammoth from 'mammoth';
import { requireAuth, AuthenticatedRequest } from '../auth/authMiddleware';
import { env } from '../config/env';
import { safeEqual } from './adminAuth';
import { getAdminSummary, getDailyStats, getUserList } from './statsQueries';
import { getCategoryByKey, createCategory, insertQuestions } from '../questions/questionRepository';
import { parseQuestionsText } from '../questions/docxQuestionParser';
import { LEAGUE_TIERS, computeTierChanges } from '../league/leagueTiers';
import {
  getFullBracket,
  applyTierChange,
  isWeekProcessed,
  markWeekProcessed,
  previousWeekStartDateString,
} from '../league/leagueRepository';

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

    let rawText: string;
    try {
      const extracted = await mammoth.extractRawText({ buffer: file.buffer });
      rawText = extracted.value;
    } catch {
      // A file that passes the .docx extension check but isn't actually a
      // valid docx (renamed .txt, truncated upload, corrupt zip) makes
      // mammoth throw - caught here so the response stays { error: string }
      // JSON like every other route, instead of falling through to
      // Express's default HTML error page.
      res.status(400).json({ error: "Fayl o'qib bo'lmadi - .docx formatida ekanligiga ishonch hosil qiling" });
      return;
    }

    const { questions, errors } = parseQuestionsText(rawText);

    if (questions.length > 0) {
      try {
        await insertQuestions(resolvedCategory.key, questions);
      } catch {
        // Distinct from the mammoth catch above: this is a DB/storage failure
        // partway through (or after) a successfully-parsed file, not a bad
        // file format - telling the admin their file is malformed here would
        // be misleading and could send them chasing a non-existent problem.
        res.status(500).json({ error: 'Savollarni saqlashda xatolik yuz berdi' });
        return;
      }
    }

    res.json({ category: resolvedCategory, inserted: questions.length, errors });
  }
);

// The host crontab that triggers this endpoint has no Telegram session to
// present a Bearer JWT with, so it authenticates the same way the
// standalone /admin/stats HTML dashboard does: HTTP Basic Auth checked
// against ADMIN_PASSWORD (see adminAuth.ts's requireAdminAuth). A request
// presenting valid Basic Auth skips requireAuth/requireAdmin entirely;
// anything else falls through to the normal Telegram-JWT admin gate, so a
// logged-in admin can still trigger this manually from the Mini App/a
// Bearer-token client exactly as before.
function isValidCronBasicAuth(req: Request): boolean {
  if (!env.adminPassword) return false;
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Basic ')) return false;
  const decoded = Buffer.from(authHeader.slice('Basic '.length), 'base64').toString('utf-8');
  const separatorIndex = decoded.indexOf(':');
  const password = separatorIndex === -1 ? '' : decoded.slice(separatorIndex + 1);
  return Boolean(password) && safeEqual(password, env.adminPassword);
}

function requireProcessWeekAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (isValidCronBasicAuth(req)) {
    next();
    return;
  }
  requireAuth(req, res, () => requireAdmin(req, res, next));
}

adminApiRouter.post(
  '/admin/league/process-week',
  requireProcessWeekAuth,
  async (_req: AuthenticatedRequest, res: Response) => {
    const weekStartDate = previousWeekStartDateString(new Date());

    if (await isWeekProcessed(weekStartDate)) {
      res.json({ alreadyProcessed: true, weekStartDate });
      return;
    }

    // Compute ALL tier changes for every tier FIRST, against a consistent
    // snapshot, before applying ANY of them. getFullBracket filters by the
    // user's CURRENT tier - applying a change mid-loop would let an
    // already-promoted user's row bleed into the NEXT tier's bracket
    // computation within this same run (using XP earned while still in
    // their old tier), letting them cascade upward multiple tiers in one
    // pass instead of exactly one, as the design intends.
    const allChanges: { userId: number; newTier: (typeof LEAGUE_TIERS)[number] }[] = [];
    for (const tier of LEAGUE_TIERS) {
      const members = await getFullBracket(tier, weekStartDate);
      allChanges.push(...computeTierChanges(tier, members));
    }

    for (const change of allChanges) {
      await applyTierChange(change.userId, change.newTier);
    }

    await markWeekProcessed(weekStartDate);
    res.json({ alreadyProcessed: false, weekStartDate });
  }
);
