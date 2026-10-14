import { createHash } from 'node:crypto';
import { AppError } from '../../errors/app-error.js';
import type { AvatarProvider } from './account.types.js';
export interface CloudinaryConfig { cloudName: string; apiKey: string; apiSecret: string }
export class CloudinaryProvider implements AvatarProvider {
  constructor(private readonly config: CloudinaryConfig, private readonly transport: typeof fetch = fetch) {}
  private async send(action: 'upload' | 'destroy', publicId: string, image?: Buffer) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const values: Record<string, string> = { public_id: publicId, timestamp, ...(action === 'upload' ? { overwrite: 'false' } : { invalidate: 'true' }) };
    const signature = createHash('sha1').update(Object.keys(values).sort().map(key => `${key}=${values[key]}`).join('&') + this.config.apiSecret).digest('hex');
    const body = new FormData();
    for (const [key, value] of Object.entries(values)) body.set(key, value);
    body.set('api_key', this.config.apiKey); body.set('signature', signature);
    if (image) body.set('file', new Blob([new Uint8Array(image)], { type: 'image/webp' }), 'avatar.webp');
    const controller = new AbortController();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const response = await this.transport(`https://api.cloudinary.com/v1_1/${encodeURIComponent(this.config.cloudName)}/image/${action}`, { method: 'POST', body, signal: controller.signal });
          if (!response.ok) throw new Error('provider rejected request');
          return await response.json() as Record<string, unknown>;
        })(),
        new Promise<never>((_resolve, reject) => { deadline = setTimeout(() => { controller.abort(); reject(new AppError(504, 'AVATAR_PROVIDER_TIMEOUT', 'Photo service timed out.')); }, 10_000); }),
      ]);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(502, 'AVATAR_PROVIDER_ERROR', 'Photo service could not complete the request.');
    } finally { if (deadline) clearTimeout(deadline); }
  }
  async upload(image: Buffer, publicId: string) {
    const result = await this.send('upload', publicId, image);
    try {
      if (result.public_id !== publicId || typeof result.secure_url !== 'string') throw new Error();
      const url = new URL(result.secure_url);
      if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com' || url.port || url.username || url.password ||
        url.search || url.hash || !url.pathname.startsWith(`/${this.config.cloudName}/image/upload/`) ||
        url.pathname === `/${this.config.cloudName}/image/upload/`) throw new Error();
      return { url: url.href, publicId };
    } catch { throw new AppError(502, 'AVATAR_PROVIDER_ERROR', 'Photo service returned an invalid image.'); }
  }
  async remove(publicId: string) {
    const result = await this.send('destroy', publicId);
    if (result.result !== 'ok' && result.result !== 'not found') throw new AppError(502, 'AVATAR_PROVIDER_ERROR', 'Photo cleanup failed.');
  }
}
