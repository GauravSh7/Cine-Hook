import type { PrismaClient } from '../../generated/prisma/client.js';
import { AccountRepository } from './account.repository.js';
import { AccountService } from './account.service.js';
import { CloudinaryProvider, type CloudinaryConfig } from './cloudinary.provider.js';
export function createAccount(prisma: PrismaClient, config?: CloudinaryConfig) {
  return new AccountService(new AccountRepository(prisma), config ? new CloudinaryProvider(config) : undefined);
}
