import type { RequestHandler } from 'express';
import { catalogueStageStatus } from '../../lib/catalogue-stage.js';
export class CatalogueStatusController {
  constructor(private readonly configuration?: { databaseUrl: string; staging: boolean }) {}
  get: RequestHandler = (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: this.configuration ? catalogueStageStatus(this.configuration.databaseUrl, this.configuration.staging)
      : { mode: 'standard', newPaymentsAllowed: true, targetFingerprint: null } });
  };
}
