import { Router } from 'express';
import { CatalogueStatusController } from './catalogue-status.controller.js';
export function catalogueStatusRoutes(configuration?: { databaseUrl: string; staging: boolean }) {
  const router = Router(), controller = new CatalogueStatusController(configuration);
  router.get('/status', controller.get);
  return router;
}
