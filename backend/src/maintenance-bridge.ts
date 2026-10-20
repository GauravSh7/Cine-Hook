import { createServer } from 'node:http';
import { maintenanceHealth, maintenanceResponse } from './middleware/maintenance.js';

// Standalone bridge: no env loader, config parser, Prisma, Redis, provider,
// application server or background worker imports. Safe before auth migration.
const port = Number(process.env.PORT ?? '4000');
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT');
const server = createServer((req, res) => {
  const path = (req.url ?? '').split('?')[0]!;
  if (maintenanceHealth(req.method, path)) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-CineHook-Maintenance': 'bridge-v1' });
    res.end(JSON.stringify({ success: true, data: { status: 'maintenance', dependencies: 'not_checked' } }));
    return;
  }
  maintenanceResponse(res, 'bridge-v1');
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(port, () => console.info(JSON.stringify({ event: 'maintenance_bridge_started', port: (server.address() as { port: number }).port })));
server.on('error', () => { console.error(JSON.stringify({ event: 'maintenance_bridge_failed' })); process.exit(1); });
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 8000);
  deadline.unref();
  server.close(() => { clearTimeout(deadline); process.exit(0); });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
