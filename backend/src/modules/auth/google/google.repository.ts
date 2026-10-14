import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import { AppError } from '../../../errors/app-error.js';
import { toPublicUser } from '../auth.types.js';
import { publicSelect } from '../user.repository.js';
import type { GoogleUserStore } from './google.types.js';
export class GoogleUserRepository implements GoogleUserStore {
  constructor(private readonly prisma: PrismaClient) {}
  async findBySubject(googleSubject: string) { const user = await this.prisma.user.findUnique({ where: { googleSubject }, select: publicSelect }); return user ? toPublicUser(user) : null; }
  async findByEmail(email: string) { return this.prisma.user.findUnique({ where: { email }, select: { ...publicSelect, passwordHash: true, googleSubject: true } }); }
  async linkGoogle(input:{userId:string;googleSubject:string;email:string;passwordHash:string}) {
    try {
      return await this.prisma.$transaction(async tx=>{
        // Compare the password snapshot again in the atomic update: a changed
        // password or concurrent different identity must never be overwritten.
        const result=await tx.user.updateMany({where:{id:input.userId,email:input.email,passwordHash:input.passwordHash,
          OR:[{googleSubject:null},{googleSubject:input.googleSubject}]},data:{googleSubject:input.googleSubject}});
        if(result.count!==1)throw new AppError(409,'GOOGLE_LINK_CONFLICT','Google linking could not be completed. Sign in again and retry.');
        return toPublicUser(await tx.user.findUniqueOrThrow({where:{id:input.userId},select:publicSelect}));
      });
    } catch(error) {
      if(error instanceof Prisma.PrismaClientKnownRequestError && error.code==='P2002')throw new AppError(409,'GOOGLE_LINK_CONFLICT','This Google identity cannot be linked to this account.');
      throw error;
    }
  }
  async linkVerifiedGoogle(input:{userId:string;googleSubject:string;email:string}) {
    try {
      return await this.prisma.$transaction(async tx=>{
        const result=await tx.user.updateMany({where:{id:input.userId,email:input.email,googleSubject:null},data:{googleSubject:input.googleSubject}});
        if(result.count!==1) {
          const winner=await tx.user.findUnique({where:{googleSubject:input.googleSubject},select:publicSelect});
          if(winner?.id===input.userId)return toPublicUser(winner);
          throw new AppError(409,'GOOGLE_IDENTITY_CONFLICT','Google identity is already linked to another account.');
        }
        return toPublicUser(await tx.user.findUniqueOrThrow({where:{id:input.userId},select:publicSelect}));
      });
    } catch(error) {
      if(error instanceof Prisma.PrismaClientKnownRequestError && error.code==='P2002') {
        const winner=await this.prisma.user.findUnique({where:{googleSubject:input.googleSubject},select:publicSelect});
        if(winner?.id===input.userId)return toPublicUser(winner);
        throw new AppError(409,'GOOGLE_IDENTITY_CONFLICT','Google identity is already linked to another account.');
      }
      throw error;
    }
  }
  async createGoogle(input: { googleSubject: string; email: string; name: string }) {
    try { return toPublicUser(await this.prisma.user.create({ data: { ...input, passwordHash: null, role: 'USER' }, select: publicSelect })); }
    catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AppError(409, 'GOOGLE_IDENTITY_CONFLICT', 'Google account identity is already registered.'); throw error; }
  }
}
