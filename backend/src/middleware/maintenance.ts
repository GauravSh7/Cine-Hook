import type { RequestHandler } from 'express';
import type { ServerResponse } from 'node:http';

export function maintenanceHealth(method: string | undefined, path: string): boolean {
  return (method === 'GET' || method === 'HEAD') && ['/api/health/live', '/api/health/ready'].includes(path);
}
export function maintenanceResponse(res: ServerResponse, source: 'bridge-v1' | 'guard-v1') {
  res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'Retry-After': '60', 'X-CineHook-Maintenance': source, Connection: 'close' });
  res.end(JSON.stringify({ success: false, error: { code: 'MAINTENANCE', message: 'CineHook is temporarily unavailable. Please try again shortly.' } }));
}
// No JWT, role, forwarding header, cookie, method or public bypass can open it.
// Run before body parsing and webhook/auth/business handlers. Flag is immutable
// for a process: reopening requires an explicit reviewed restart/deployment.
export const maintenanceGuard: RequestHandler = (req, res, next) => {
  if (maintenanceHealth(req.method, req.path)) return next();
  maintenanceResponse(res, 'guard-v1');
};
