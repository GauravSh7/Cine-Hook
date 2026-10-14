import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

export function createPrisma(databaseUrl: string) {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 2000,
    // Prisma's pg adapter serializes Date parameters without a timezone suffix.
    // Force every pooled session to UTC so TIMESTAMPTZ preserves the instant,
    // independently of the host/database default timezone.
    options: '-c statement_timeout=2000 -c timezone=UTC',
  });
  return new PrismaClient({ adapter });
}
