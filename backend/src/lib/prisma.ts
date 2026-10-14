import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { logDependencyFailure } from './dependency-diagnostics.js';

export function createPrisma(databaseUrl: string) {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    max: 10,
    // Allow DNS, TLS negotiation and hosted database cold starts to complete.
    connectionTimeoutMillis: 10000,
    // Prisma's pg adapter serializes Date parameters without a timezone suffix.
    // Force every pooled session to UTC so TIMESTAMPTZ preserves the instant,
    // independently of the host/database default timezone.
    options: '-c statement_timeout=2000 -c timezone=UTC',
  }, {
    onPoolError: error => logDependencyFailure('database_pool_error', 'database', error),
    onConnectionError: error => logDependencyFailure('database_connection_error', 'database', error),
  });
  return new PrismaClient({ adapter });
}
