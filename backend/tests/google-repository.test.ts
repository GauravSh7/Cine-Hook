import { expect, it } from 'vitest';
import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';
import { GoogleUserRepository } from '../src/modules/auth/google/google.repository.js';
const input = { name: 'Google user', email: 'google@example.com', googleSubject: '123456' };
it('maps database uniqueness without disclosing details', async () => {
  const db = { user: { create: async () => { throw new Prisma.PrismaClientKnownRequestError('private constraints', { code: 'P2002', clientVersion: '7.10.0' }); } } } as unknown as PrismaClient;
  await expect(new GoogleUserRepository(db).createGoogle(input)).rejects.toMatchObject({ code: 'GOOGLE_IDENTITY_CONFLICT', status: 409 });
});
it('creates a null password USER and strips returned secret fields', async () => {
  let saved: any;
  const db = { user: { create: async (args: any) => { saved = args; return { ...args.data, id: 'unit-user', createdAt: new Date(), updatedAt: new Date(), privateField: 'secret' }; } } } as unknown as PrismaClient;
  const publicUser = await new GoogleUserRepository(db).createGoogle(input);
  expect(saved.data).toEqual({ ...input, passwordHash: null, role: 'USER' }); expect(saved.select).not.toHaveProperty('googleSubject'); expect(saved.select).not.toHaveProperty('passwordHash');
  expect(publicUser).not.toHaveProperty('googleSubject'); expect(publicUser).not.toHaveProperty('privateField');
});
