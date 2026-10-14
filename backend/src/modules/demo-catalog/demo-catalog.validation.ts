import { z } from 'zod';
const filter = z.string().trim().max(100).transform(value => value || undefined).optional();
const number = (max: number, fallback: number) => z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(max)).default(fallback);
export const demoKindSchema = z.object({ kind: z.enum(['stream', 'events', 'sports', 'activities']).transform(kind => kind.toUpperCase() as 'STREAM' | 'EVENTS' | 'SPORTS' | 'ACTIVITIES') }).strict();
export const demoDetailSchema = demoKindSchema.extend({ id: z.uuid() }).strict();
export const demoQuerySchema = z.object({ cityId: z.uuid().optional(), category: filter, search: filter, page: number(100000, 1), limit: number(100, 20) }).strict();
