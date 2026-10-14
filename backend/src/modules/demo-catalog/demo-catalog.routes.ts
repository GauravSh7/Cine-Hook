import { Router } from 'express';
import { validateRequest } from '../../middleware/validate-request.js';
import { DemoCatalogController } from './demo-catalog.controller.js';
import { demoKindSchema, demoDetailSchema, demoQuerySchema } from './demo-catalog.validation.js';
import type { DemoCatalog } from './demo-catalog.types.js';
export function demoCatalogRoutes(service: DemoCatalog) {
  const router = Router({ caseSensitive: true });
  const controller = new DemoCatalogController(service);
  router.get('/:kind', validateRequest(demoKindSchema, 'params'), validateRequest(demoQuerySchema, 'query'), controller.list);
  router.get('/:kind/:id', validateRequest(demoDetailSchema, 'params'), controller.get);
  return router;
}
