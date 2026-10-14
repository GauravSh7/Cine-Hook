import type { Prisma } from '../src/generated/prisma/client.js';
import { inventoryCounts, type CatalogueGroup, type CatalogueModel, type ImportRow } from './staging-manifest.js';
import { assertCatalogueGroups } from './staging-shape.js';

type Store = { findMany(args: unknown): Promise<ImportRow[]>; createMany(args: unknown): Promise<{count: number}>; count(args: unknown): Promise<number> };
const value = (v: unknown) => v instanceof Date ? v.toISOString() : typeof v === 'string' ? v.toLowerCase() : JSON.stringify(v);
const same = (a: ImportRow, b: ImportRow, keys: string[]) => keys.every(key => value(a[key]) === value(b[key]));
const where = (row: ImportRow, keys: string[]) => Object.fromEntries(keys.map(key => [key, row[key]]));
const collision = (model: CatalogueModel): never => { throw new Error(`Staging catalogue identity/layout collision (${model}); no existing data may be changed.`); };
export async function inspectCatalogue(tx: Prisma.TransactionClient, manifest: CatalogueGroup[]) {
  assertCatalogueGroups(manifest,true);
  const pending: CatalogueGroup[] = [], existing = new Map<CatalogueModel, ImportRow[]>();
  for (const group of manifest) {
    const store = tx[group.model] as unknown as Store;
    const alternatives: ImportRow[] = group.rows.flatMap(row => [where(row, group.keys), where(row, group.identity)]);
    if (group.model === 'seat') alternatives.push({ screenId: { in: [...new Set(group.rows.map(row => row.screenId))] } });
    if (group.model === 'eventSection') alternatives.push({ venueId: { in: [...new Set(group.rows.map(row => row.venueId))] } });
    if (group.model === 'eventSeat') alternatives.push({ sectionId: { in: [...new Set(group.rows.map(row => row.sectionId))] } });
    // Bound query expression depth for the complete Indian city directory.
    const unique=new Map<string,ImportRow>();
    const key=(row:ImportRow,keys:string[])=>JSON.stringify(keys.map(k=>value(row[k])));
    for(let offset=0;offset<alternatives.length;offset+=400){
      for(const record of await store.findMany({where:{OR:alternatives.slice(offset,offset+400)}}))unique.set(key(record,group.keys),record);
    }
    const records=[...unique.values()];
    existing.set(group.model, records);
    const primary=new Map(records.map(r=>[key(r,group.keys),r])),natural=new Map(records.map(r=>[key(r,group.identity),r]));
    const missing: ImportRow[] = [];
    for (const row of group.rows) {
      const matches = [...new Set([primary.get(key(row,group.keys)),natural.get(key(row,group.identity))].filter((r):r is ImportRow=>!!r))];
      if (matches.length > 1 || (matches[0] && (!same(row, matches[0], group.keys) || !same(row, matches[0], group.immutable)))) collision(group.model);
      if (!matches.length) missing.push(row);
    }
    const intendedKeys=new Set(group.rows.map(r=>key(r,group.keys)));
    if (['seat','eventSection','eventSeat'].includes(group.model) && records.some(record => !intendedKeys.has(key(record,group.keys)))) collision(group.model);
    pending.push({ ...group, rows: missing });
  }
  // Never extend an existing physical layout after sessions depend on it.
  const screenIds = new Set(existing.get('screen')?.map(row => row.id));
  const venueIds = new Set(existing.get('eventVenue')?.map(row => row.id));
  const newSeats = pending.find(group => group.model === 'seat')!.rows;
  for (const screenId of new Set(newSeats.filter(row => screenIds.has(row.screenId)).map(row => row.screenId))) {
    if (await tx.show.count({ where: { screenId: screenId as string } })) collision('seat');
  }
  const newSections = pending.find(group => group.model === 'eventSection')!.rows;
  const newEventSeats = pending.find(group => group.model === 'eventSeat')!.rows;
  const sections = manifest.find(group => group.model === 'eventSection')!.rows;
  const changingVenues = new Set([...newSections.map(row => row.venueId), ...newEventSeats.map(row => sections.find(s => s.id === row.sectionId)?.venueId)].filter(id => venueIds.has(id)));
  for (const venueId of changingVenues) if (await tx.eventSession.count({ where: { venueId: venueId as string } })) collision('eventSeat');
  return { groups: pending, existing:[...existing].map(([model,rows])=>({...manifest.find(g=>g.model===model)!,rows})),createCounts: inventoryCounts(pending) };
}
export async function applyCatalogue(tx: Prisma.TransactionClient, plan: Awaited<ReturnType<typeof inspectCatalogue>>) {
  assertCatalogueGroups(plan.groups,true);
  for (const group of plan.groups) {
    const store = tx[group.model] as unknown as Store;
    for (let offset = 0; offset < group.rows.length; offset += 200) {
      // No skipDuplicates: a race/conflict aborts the whole transaction, never a partial inventory graph.
      const data = group.rows.slice(offset, offset + 200);
      const result = await store.createMany({ data });
      if (result.count !== data.length) throw new Error('Staging catalogue insert count mismatch; transaction must roll back.');
    }
  }
  return plan.createCounts;
}
