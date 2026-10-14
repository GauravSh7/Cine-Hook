import { z } from 'zod';
import { pageSchema } from '../catalog/catalog.validation.js';

const optionalId = z.preprocess(value => typeof value === 'string' && !value.trim() ? undefined : value, z.string().uuid().optional());
export const eventQuerySchema = pageSchema.extend({
  kind: z.preprocess(value => value === '' ? undefined : value, z.enum(['EVENTS', 'SPORTS', 'ACTIVITIES']).optional()),
  cityId: optionalId,
  search: z.string().trim().max(100).transform(value => value || undefined).optional(),
}).strict();
export const eventSessionQuerySchema = pageSchema.extend({ eventId: optionalId, cityId: optionalId }).strict();
