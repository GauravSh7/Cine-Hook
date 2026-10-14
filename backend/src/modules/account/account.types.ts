import type { PublicUser } from '../auth/auth.types.js';
export interface ProfilePatch { name?: string; dateOfBirth?: Date | null; phone?: string | null }
export interface AccountStore {
  updateProfile(userId: string, patch: ProfilePatch): Promise<PublicUser>;
  swapAvatar(userId: string, avatar: { url: string; publicId: string }): Promise<{ user: PublicUser; oldPublicId: string | null }>;
  getAvatarPublicId(userId: string): Promise<string | null>;
}
export interface AvatarProvider {
  upload(image: Buffer, publicId: string): Promise<{ url: string; publicId: string }>;
  remove(publicId: string): Promise<void>;
}
