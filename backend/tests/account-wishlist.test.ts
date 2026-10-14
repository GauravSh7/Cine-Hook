import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import { HealthService } from '../src/modules/health/health.service.js';
import { testCatalog } from './helpers/catalog.js';
import { AccountService } from '../src/modules/account/account.service.js';
import { WishlistService } from '../src/modules/wishlist/wishlist.service.js';

const user = { id: randomUUID(), name: 'Viewer', email: 'viewer@example.com', role: 'USER' as const,
  createdAt: new Date(), updatedAt: new Date(), dateOfBirth: new Date('2000-02-29T00:00:00Z'),
  phone: '+919876543210', avatarUrl: 'https://res.cloudinary.com/demo/image/upload/avatar.webp',
  avatarPublicId: 'private-provider-id', passwordHash: 'private-password-hash' };
const tokens = new TokenService({ secret: 'test-only-account-key-12345678901234567890', expiresInSeconds: 3600 });
const auth = new AuthService({ create: async () => user, findByEmail: async () => user, findById: async () => user }, tokens);
const app = createApp({ frontendOrigin: 'http://localhost:5173', auth: { service: auth, tokens },
  healthService: new HealthService({ checkDatabase: async () => {}, checkRedis: async () => {} }), catalog: testCatalog().services,
  account: new AccountService({ updateProfile: async () => user, swapAvatar: async () => ({ user, oldPublicId: null }), getAvatarPublicId: async () => null }),
  wishlist: new WishlistService({ list: async () => [], isSaved: async () => false, save: async () => {}, remove: async () => {} }),
});

it('returns date-only profile fields in /me without exposing internal avatar identifiers', async () => {
  const response = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tokens.sign({ userId: user.id, role: 'USER' })}`);
  expect(response.status).toBe(200);
  expect(response.body.data.user).toMatchObject({ dateOfBirth: '2000-02-29', phone: '+919876543210', avatarUrl: user.avatarUrl });
  expect(response.body.data.user).not.toHaveProperty('avatarPublicId');
  expect(response.body.data.user).not.toHaveProperty('passwordHash');
});

it('authenticates profile changes before accepting a body', async () => {
  const response = await request(app).patch('/api/account/profile').send({ name: 'Changed' });
  expect(response.status).toBe(401);
});
it('authenticates wishlist reads', async () => {
  const response = await request(app).get('/api/wishlist/movies');
  expect(response.status).toBe(401);
});
