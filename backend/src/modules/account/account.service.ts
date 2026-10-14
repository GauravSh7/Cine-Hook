import { randomUUID } from 'node:crypto';
import { AppError } from '../../errors/app-error.js';
import { toPublicUser } from '../auth/auth.types.js';
import type { AccountStore, AvatarProvider } from './account.types.js';
import { profilePatchSchema } from './account.validation.js';
import { prepareAvatar } from './avatar-image.js';
export class AccountService {
  constructor(private readonly store: AccountStore, private readonly provider?: AvatarProvider) {}
  async updateProfile(userId: string, input: unknown) {
    const parsed = profilePatchSchema.safeParse(input);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'Profile fields are invalid.');
    return toPublicUser(await this.store.updateProfile(userId, parsed.data));
  }
  async uploadAvatar(userId: string, image: Buffer, mime: string) {
    if (!this.provider) throw new AppError(503, 'AVATAR_UNAVAILABLE', 'Photo upload is currently unavailable.');
    const buffer = await prepareAvatar(image, mime);
    const publicId = `cinehook/avatars/${userId}/${randomUUID()}`;
    const avatar = await this.provider.upload(buffer, publicId);
    if (avatar.publicId !== publicId) throw new AppError(502, 'AVATAR_PROVIDER_ERROR', 'Photo upload failed.');
    let saved;
    try { saved = await this.store.swapAvatar(userId, avatar); }
    catch (error) {
      // A dropped commit response is ambiguous. Delete only after a fresh read
      // confirms this asset is not the account's current avatar.
      try { if (await this.store.getAvatarPublicId(userId) !== publicId) await this.provider.remove(publicId); } catch { /* orphan retained safely */ }
      throw error;
    }
    if (saved.oldPublicId && saved.oldPublicId !== publicId) {
      try { await this.provider.remove(saved.oldPublicId); } catch { /* best-effort old asset cleanup */ }
    }
    return toPublicUser(saved.user);
  }
}
