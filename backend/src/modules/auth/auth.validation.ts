import { z } from 'zod';

const email = z.string().trim().toLowerCase().max(254).email();
const password = z.string().min(1).max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72 && !value.includes('\0'));
export const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email,
  password: password.refine(value => Array.from(value).length >= 8),
}).strict();
export const loginSchema = z.object({ email, password }).strict();
