import { randomUUID } from 'node:crypto';
import { createApp } from '../../src/app.js';
import { AppError } from '../../src/errors/app-error.js';
import { HealthService } from '../../src/modules/health/health.service.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { TokenService } from '../../src/modules/auth/token.service.js';
import { toPublicUser, type StoredUser } from '../../src/modules/auth/auth.types.js';
import { AccountService } from '../../src/modules/account/account.service.js';
import type { AccountStore, ProfilePatch } from '../../src/modules/account/account.types.js';
import { CloudinaryProvider } from '../../src/modules/account/cloudinary.provider.js';
import { WishlistService } from '../../src/modules/wishlist/wishlist.service.js';
import type { WishlistStore } from '../../src/modules/wishlist/wishlist.types.js';
import { testCatalog } from './catalog.js';
export const cloudConfig = { cloudName: 'cinehook-test', apiKey: 'test-key', apiSecret: 'test-provider-secret' };
export function accountFixture(options: { transport?: typeof fetch; provider?: boolean } = {}) {
  const users = new Map<string, StoredUser>();
  for (const name of ['Viewer', 'Other']) {
    const id = randomUUID(); users.set(id, { id, name, email: `${name.toLowerCase()}@example.com`, role: 'USER',
      passwordHash: 'not-used-for-login-in-this-fixture', dateOfBirth: null, phone: null,
      avatarUrl: 'https://res.cloudinary.com/cinehook-test/image/upload/old.webp', avatarPublicId: `old/${id}`,
      createdAt: new Date(), updatedAt: new Date() });
  }
  const [user, other] = [...users.values()] as [StoredUser, StoredUser];
  let failSwap = false; let failRead = false;
  const accounts: AccountStore = {
    updateProfile: async (id, patch: ProfilePatch) => { const u = users.get(id)!; Object.assign(u, patch); return toPublicUser(u); },
    swapAvatar: async (id, avatar) => {
      if (failSwap) throw new Error('database unavailable');
      const u = users.get(id)!; const oldPublicId = u.avatarPublicId ?? null;
      u.avatarUrl = avatar.url; u.avatarPublicId = avatar.publicId;
      return { user: toPublicUser(u), oldPublicId };
    },
    getAvatarPublicId: async id => { if (failRead) throw new Error('database unavailable'); return users.get(id)?.avatarPublicId ?? null; },
  };
  const operations: { action: string; publicId: string; image?: Blob }[] = [];
  const transport: typeof fetch = options.transport ?? (async (url, init) => {
    const form = init!.body as FormData; const publicId = form.get('public_id') as string;
    const action = String(url).split('/').at(-1)!; const file = form.get('file');
    operations.push({ action, publicId, image: file instanceof Blob ? file : undefined });
    return new Response(JSON.stringify(action === 'upload'
      ? { public_id: publicId, secure_url: `https://res.cloudinary.com/cinehook-test/image/upload/v1/${publicId}.webp` }
      : { result: 'ok' }), { status: 200 });
  });
  const account = new AccountService(accounts, options.provider === false ? undefined : new CloudinaryProvider(cloudConfig, transport));
  const catalog = testCatalog();
  const rows = new Map<string, { userId: string; movieId: string; createdAt: Date }>();
  const key = (u: string, m: string) => `${u}:${m}`;
  const wishlistStore: WishlistStore = {
    list: async (id, page) => [...rows.values()].filter(x => x.userId === id)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.movieId.localeCompare(b.movieId))
      .slice((page.page - 1) * page.limit, page.page * page.limit).map(x => ({ movie: catalog.movies.get(x.movieId)!, createdAt: x.createdAt })),
    isSaved: async (u, m) => rows.has(key(u, m)),
    save: async (u, m) => { if (!catalog.movies.get(m)?.isActive) throw new AppError(404, 'NOT_FOUND', 'Active movie not found.'); if (!rows.has(key(u, m))) rows.set(key(u, m), { userId: u, movieId: m, createdAt: new Date() }); },
    remove: async (u, m) => { rows.delete(key(u, m)); },
  };
  const wishlist = new WishlistService(wishlistStore);
  const tokens = new TokenService({ secret: 'test-account-signing-secret-123456789012345', expiresInSeconds: 3600 });
  const auth = new AuthService({ create: async () => toPublicUser(user), findByEmail: async email => [...users.values()].find(x => x.email === email) ?? null,
    findById: async id => { const u = users.get(id); return u ? toPublicUser(u) : null; } }, tokens);
  const app = createApp({ frontendOrigin: 'http://localhost:5173', auth: { service: auth, tokens },
    healthService: new HealthService({ checkDatabase: async () => {}, checkRedis: async () => {} }),
    catalog: catalog.services, account, wishlist });
  return { app, account, wishlist, users, user, other, operations, catalog, rows,
    authorization: (id = user.id) => `Bearer ${tokens.sign({ userId: id, role: 'USER' })}`,
    failSwap: () => { failSwap = true; }, failRead: () => { failRead = true; } };
}
