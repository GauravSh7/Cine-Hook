import type { PublicUser, StoredUser } from '../auth.types.js';

export interface GoogleUserStore {
  findBySubject(subject: string): Promise<PublicUser | null>;
  findByEmail(email: string): Promise<StoredUser | null>;
  createGoogle(input: { googleSubject: string; email: string; name: string }): Promise<PublicUser>;
  linkGoogle?(input:{userId:string;googleSubject:string;email:string;passwordHash:string}):Promise<PublicUser>;
  linkVerifiedGoogle?(input:{userId:string;googleSubject:string;email:string}):Promise<PublicUser>;
}
export interface GoogleVerifier { verify(credential: string): Promise<unknown> }
