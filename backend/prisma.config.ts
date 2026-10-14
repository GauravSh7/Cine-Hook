import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // CLI generation/validation needs no live database. Migration commands need
  // an explicit DATABASE_URL; an empty value fails instead of targeting a default DB.
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
