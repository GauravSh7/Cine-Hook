import type { PrismaClient } from '../src/generated/prisma/client.js';
import { FILMS, seedId, futureShowStarts } from './dev-seed-manifest.js';
import { DEMO_LISTINGS, HINDI_SUMMARIES } from './refinement-manifest.js';
export type RefinementSeedOptions = { expectedDatabase: string; expectedPort: number; now?: Date };
export async function seedRefinementContent(prisma: PrismaClient, options: RefinementSeedOptions) {
  if (!((options.expectedDatabase === 'cinehook_dev' && options.expectedPort === 5432) ||
    (/^[A-Za-z0-9_]+_test$/.test(options.expectedDatabase) && Number.isInteger(options.expectedPort) && options.expectedPort > 0 && options.expectedPort <= 65535))) throw new Error('Invalid refinement seed target.');
  const firstDate = futureShowStarts(options.now ?? new Date())[0]!;
  return prisma.$transaction(async tx => {
    const identity = (await tx.$queryRaw<Array<{ database: string; schema: string; port: number }>>`SELECT current_database() AS database, current_schema() AS schema, inet_server_port() AS port`)[0];
    if (!identity || identity.database !== options.expectedDatabase || identity.schema !== 'public' || identity.port !== options.expectedPort) throw new Error('Refinement seed identity mismatch.');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(1667853941, 1936024932)`;
    const created = { STREAM: 0, EVENTS: 0, SPORTS: 0, ACTIVITIES: 0 }, enriched = { hindi: 0 };
    for (const film of FILMS) {
      const result = await tx.movie.updateMany({ where: { id: seedId(`movie:${film.key}`), title: film.title, language: film.language,
        releaseDate: new Date(`${film.releaseDate}T00:00:00Z`), OR: [{ descriptionHindi: null }, { descriptionHindi: '' }] }, data: { descriptionHindi: HINDI_SUMMARIES[film.key]! } });
      enriched.hindi += result.count;
    }
    for (const [index, row] of DEMO_LISTINGS.entries()) {
      const id = seedId(`listing:${row.slug}`);
      const candidates = await tx.demoListing.findMany({ where: { OR: [{ id }, { slug: row.slug }] } });
      if (candidates.length && (candidates.length !== 1 || candidates[0]!.id !== id || candidates[0]!.slug !== row.slug || candidates[0]!.kind !== row.kind)) throw new Error('Refinement demo identity collision; all changes rolled back.');
      if (candidates.length) {
        // Change only exact old seed artwork, never operator-edited assets or booking data.
        await tx.demoListing.updateMany({where:{id,imageUrl:{in:[`/demo-category-art/${row.kind.toLowerCase()}.svg`,...(row.slug==='demo-pottery-workshop'?['https://images.unsplash.com/photo-1565193298595-6ba5b1a0db32?auto=format&fit=crop&w=1600&q=85']:[])]}},data:{imageUrl:row.imageUrl,imageAttribution:row.imageAttribution}});
        continue;
      }
      await tx.demoListing.create({ data: { ...row, id, startsAt: row.kind === 'EVENTS' || row.kind === 'SPORTS' ? new Date(firstDate.getTime() + (index % 6) * 86400000) : null } });
      created[row.kind]++;
    }
    return { created, enriched };
  }, { maxWait: 60000, timeout: 120000 });
}
