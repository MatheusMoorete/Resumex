import express, { Express, Request, Response } from 'express';
import path from 'node:path';
import { rootDir } from './config/env.js';
import { jsonErrorHandler, securityHeadersHandler } from './middlewares/security.js';
import { requireAuth } from './middlewares/auth.js';
import { rateLimit } from './middlewares/rateLimit.js';

import healthRouter from './routes/health.js';
import aiProxyRouter from './routes/aiProxy.js';
import notionRouter from './routes/notion.js';
import adminMetricsRouter from './routes/adminMetrics.js';
import summaryJobsRouter from '../summaryJobs.js';
import quizJobsRouter from '../quizJobs.js';
import flashcardJobsRouter from '../flashcardJobs.js';

const app: Express = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.json({ limit: '8mb' }));
app.use(jsonErrorHandler);
app.use(securityHeadersHandler);

// API Routes
app.use('/api', healthRouter);
app.use('/api', adminMetricsRouter);
app.use(
  '/api/summary/jobs',
  requireAuth,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 1000, name: 'summary-jobs' }),
  summaryJobsRouter
);
app.use(
  '/api/quiz/jobs',
  requireAuth,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 500, name: 'quiz-jobs' }),
  quizJobsRouter
);
app.use(
  '/api/flashcard/jobs',
  requireAuth,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 500, name: 'flashcard-jobs' }),
  flashcardJobsRouter
);
app.use('/api/notion', notionRouter);
app.use('/api', aiProxyRouter);

// SPA Static & Fallback
app.use(express.static(path.join(rootDir, 'dist')));
app.get(/.*/, (_req: Request, res: Response) => {
  res.sendFile(path.join(rootDir, 'dist', 'index.html'));
});

export default app;
