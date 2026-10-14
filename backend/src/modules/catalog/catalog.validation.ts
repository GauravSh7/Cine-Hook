import { z } from 'zod';
import { safeArtworkUrl, COLLECTION_KEYS } from './public-movie.js';

const name = z.string().trim().min(1).max(100);
const filter = z.string().trim().max(100).transform(value => value || undefined).optional();
const pageFields = { page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) };
export const pageSchema = z.object(pageFields).strict();
export const cityQuerySchema = z.object({ ...pageFields, search: z.string().trim().max(100).transform(value => value || undefined).optional(), state: z.string().trim().max(100).transform(value => value || undefined).optional() }).strict();
export const idSchema = z.object({ id: z.string().uuid() }).strict();
export const movieCitySchema = z.object({ cityId: z.preprocess(value => value === '' ? undefined : value, z.string().uuid().optional()) }).strict();
export const movieQuerySchema = z.object({ ...pageFields, search: filter, language: filter, genre: filter, ...movieCitySchema.shape }).strict()
  .transform(input => ({ ...input, language: input.language?.toLowerCase(), genre: input.genre?.toLowerCase() }));
export const theatreQuerySchema = z.object({ ...pageFields,
  cityId: z.preprocess(value => typeof value === 'string' && !value.trim() ? undefined : value, z.string().uuid().optional()),
}).strict();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number(value.slice(0, 4)) >= 1 && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}).transform(value => new Date(`${value}T00:00:00.000Z`));
const movieFields = {
  title: z.string().trim().min(1).max(200), description: z.string().trim().min(1).max(5000),
  durationMinutes: z.number().int().min(1).max(600), releaseDate: date,
  language: z.string().trim().min(1).max(50).toLowerCase(),
  genres: z.array(z.string().trim().min(1).max(50).toLowerCase()).min(1).max(10).transform(values => [...new Set(values)]),
  posterUrl: z.string().max(2048).refine(value => safeArtworkUrl(value) !== null).nullable(),
  backdropUrl: z.string().max(2048).refine(value => safeArtworkUrl(value) !== null).nullable().optional(),
  collections: z.array(z.enum(COLLECTION_KEYS)).max(6).transform(values => [...new Set(values)]).optional(),
};
export const movieCreateSchema = z.object({ ...movieFields, posterUrl: movieFields.posterUrl.default(null) }).strict();
export const moviePatchSchema = z.object(movieFields).partial().strict().refine(value => Object.keys(value).length > 0);
export const cityCreateSchema = z.object({ name, state: name, countryCode: z.string().trim().regex(/^[A-Za-z]{2}$/).toUpperCase().default('IN') }).strict();
const theatreFields = { name, address: z.string().trim().min(1).max(500), cityId: z.string().uuid() };
export const theatreCreateSchema = z.object(theatreFields).strict();
export const theatrePatchSchema = z.object(theatreFields).partial().strict().refine(value => Object.keys(value).length > 0);
const screenFields = { name, capacity: z.number().int().min(1).max(1000), theatreId: z.string().uuid() };
export const screenCreateSchema = z.object(screenFields).strict();
export const screenPatchSchema = z.object(screenFields).partial().strict().refine(value => Object.keys(value).length > 0);
