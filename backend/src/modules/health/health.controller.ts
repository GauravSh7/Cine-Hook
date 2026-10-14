import type { RequestHandler } from 'express';
import type { HealthService } from './health.service.js';

export class HealthController {
  constructor(private readonly service: HealthService) {}

  live: RequestHandler = (_req, res) => {
    res.json({ success: true, data: { status: 'alive' } });
  };

  ready: RequestHandler = async (_req, res) => {
    const health = await this.service.readiness();
    res.status(health.status === 'ready' ? 200 : 503).json({
      success: health.status === 'ready', data: health,
    });
  };
}
