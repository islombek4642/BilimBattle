import { Router } from 'express';
import { CATEGORIES } from './questionRepository';

export const questionsRouter = Router();

questionsRouter.get('/categories', (_req, res) => {
  res.json({ categories: CATEGORIES });
});
