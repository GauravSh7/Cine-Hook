import { z } from 'zod';
import { pageSchema } from '../catalog/catalog.validation.js';

const seatType = z.enum(['REGULAR', 'PREMIUM', 'RECLINER']);
const seat = z.object({
  rowName: z.string().trim().toUpperCase().regex(/^[A-Z]{1,10}$/),
  seatNumber: z.number().int().min(1).max(2147483647), seatType,
}).strict();
export const layoutSchema = z.object({ seats: z.array(seat).min(1).max(1000) }).strict()
  .refine(input => new Set(input.seats.map(value => `${value.rowName}:${value.seatNumber}`)).size === input.seats.length);

// Validate the local calendar components before Date parses an offset. JS Date
// would otherwise normalize impossible dates such as February 30 silently.
const startsAt = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/).refine(value => {
  const local = value.slice(0, 19);
  const calendar = new Date(`${local}Z`);
  if (Number(value.slice(0, 4)) < 1 || !Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 19) !== local) return false;
  const offset = value.endsWith('Z') ? null : value.slice(-6);
  if (offset && (Number(offset.slice(1, 3)) > 14 || Number(offset.slice(4)) > 59
    || (Number(offset.slice(1, 3)) === 14 && Number(offset.slice(4)) !== 0))) return false;
  const normalized = new Date(value);
  return Number.isFinite(normalized.getTime()) && normalized.getUTCFullYear() >= 1 && normalized.getUTCFullYear() <= 9999;
}).transform(value => new Date(value));
export const showCreateSchema = z.object({ movieId: z.string().uuid(), screenId: z.string().uuid(), startsAt,
  prices: z.array(z.object({ seatType, pricePaise: z.number().int().min(1).max(2147483647) }).strict()).min(1).max(3),
}).strict().refine(input => new Set(input.prices.map(price => price.seatType)).size === input.prices.length);

const optionalId = z.preprocess(value => typeof value === 'string' && !value.trim() ? undefined : value, z.string().uuid().optional());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number(value.slice(0, 4)) >= 1 && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}).transform(value => new Date(`${value}T00:00:00.000Z`));
export const showQuerySchema = pageSchema.extend({ movieId: optionalId, cityId: optionalId, theatreId: optionalId,
  date: z.preprocess(value => typeof value === 'string' && !value.trim() ? undefined : value, date.optional()),
  localDate: z.preprocess(value => value === '' ? undefined : value, date.transform(value => new Date(value.getTime() - 330 * 60000)).optional()),
}).strict().refine(value => !(value.date && value.localDate), { message: 'Use either date or localDate.' });
