import type { PublicUser, StoredUser } from '../auth.types.js';
export type GoogleSessionUser = PublicUser & Pick<StoredUser, 'authVersion' | 'emailVerifiedAt' | 'authDisabledAt' | 'passwordHash'>;

export interface GoogleUserStore {
  findBySubject(subject: string): Promise<GoogleSessionUser | null>;
  findByEmail(email: string): Promise<StoredUser | null>;
  createGoogle(input: { googleSubject: string; email: string; name: string }): Promise<GoogleSessionUser>;
  linkGoogle?(input:{userId:string;googleSubject:string;email:string;passwordHash:string;authVersion:number}):Promise<GoogleSessionUser>;
  confirmSubject?(input:{userId:string;googleSubject:string;email:string;authVersion:number;verifyEmail:boolean}):Promise<GoogleSessionUser>;
}
export interface GoogleVerifier { verify(credential: string): Promise<unknown> }
