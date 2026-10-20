import { z } from 'zod';

const email = z.string().trim().toLowerCase().max(254).email();
const password = z.string().min(1).max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72 && !value.includes('\0'));
export const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email,
  password: password.refine(value => Array.from(value).length >= 8),
  registrationToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
}).strict();
export const loginSchema = z.object({ email, password }).strict();
