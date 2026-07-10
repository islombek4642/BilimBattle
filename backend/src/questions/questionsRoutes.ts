import { Router } from 'express';
import { getCategories } from './questionRepository';

export const questionsRouter = Router();

questionsRouter.get('/categories', async (_req, res) => {
  const categories = await getCategories();
  res.json({ categories });
});
