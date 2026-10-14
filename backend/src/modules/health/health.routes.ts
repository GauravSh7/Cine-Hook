import { Router } from 'express';
import { HealthController } from './health.controller.js';
import type { HealthService } from './health.service.js';

export function healthRoutes(service: HealthService) {
  const router = Router();
  const controller = new HealthController(service);
  router.get('/live', controller.live);
  router.get('/ready', controller.ready);
  return router;
}
