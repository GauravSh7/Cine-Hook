import { z } from 'zod';
const dateOfBirth = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number(value.slice(0, 4)) >= 1 && Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value && value <= new Date().toISOString().slice(0, 10);
}).transform(value => new Date(`${value}T00:00:00.000Z`));
export const profilePatchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  dateOfBirth: dateOfBirth.nullable().optional(),
  phone: z.string().regex(/^\+[1-9][0-9]{7,14}$/).nullable().optional(),
}).strict().refine(value => Object.keys(value).length > 0);
