import sharp from 'sharp';
import { AppError } from '../../errors/app-error.js';
export const avatarByteLimit = 3 * 1024 * 1024;
const formats: Record<string, string> = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };
function rejectAnimatedPng(buffer: Buffer) {
  // libvips may expose only the first APNG frame, so pages alone is insufficient.
  // Parse chunk boundaries rather than searching compressed pixels for "acTL".
  for (let offset = 8; offset < buffer.length;) {
    if (offset + 12 > buffer.length) throw new Error('invalid PNG');
    const length = buffer.readUInt32BE(offset);
    if (length > buffer.length - offset - 12) throw new Error('invalid PNG');
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (type === 'acTL') throw new Error('animated PNG');
    offset += length + 12;
    if (type === 'IEND') break;
  }
}
export async function prepareAvatar(buffer: Buffer, mime: string): Promise<Buffer> {
  if (buffer.length > avatarByteLimit) throw new AppError(413, 'AVATAR_TOO_LARGE', 'Image must be at most 3 MiB.');
  if (!formats[mime]) throw new AppError(400, 'INVALID_IMAGE', 'Use a JPEG, PNG or WebP image.');
  try {
    const image = sharp(buffer, { animated: true, limitInputPixels: 16_000_000, failOn: 'warning' });
    const metadata = await image.metadata();
    if (metadata.format === 'png') rejectAnimatedPng(buffer);
    if (metadata.format !== formats[mime] || !metadata.width || !metadata.height ||
      metadata.width > 4096 || metadata.height > 4096 || metadata.width * metadata.height > 16_000_000 ||
      (metadata.pages ?? 1) > 1 || metadata.loop !== undefined || metadata.delay !== undefined) throw new Error('invalid image');
    return await image.rotate().resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
  } catch {
    throw new AppError(400, 'INVALID_IMAGE', 'Image is invalid, animated or too large in dimensions.');
  }
}
