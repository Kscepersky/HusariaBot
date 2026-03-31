import { Router } from 'express';
import { join } from 'path';
import { requireAuth } from '../middleware/require-auth.js';

export const pagesRouter = Router();

const VIEWS = join(__dirname, '..', 'views');

pagesRouter.get('/', requireAuth, (_req, res) => {
    res.sendFile(join(VIEWS, 'dashboard.html'));
});
