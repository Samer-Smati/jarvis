import { Controller, Get, Req, Res } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Request, Response } from 'express';

const publicPath = process.env.FRONTEND_PATH ?? join(__dirname, '..', 'public');
const indexHtml = join(publicPath, 'index.html');

/** Angular SPA fallback — settings/dashboard deep links must serve index.html. */
@Controller()
export class SpaFallbackController {
  @Get(['dashboard', 'settings'])
  spa(@Req() req: Request, @Res() res: Response): void {
    if (!existsSync(indexHtml)) {
      res.status(404).send('Frontend not built');
      return;
    }
    if (req.path.startsWith('/api')) {
      res.status(404).json({ message: 'Not found' });
      return;
    }
    res.sendFile(indexHtml);
  }
}
