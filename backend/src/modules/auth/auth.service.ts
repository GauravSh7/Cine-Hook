import bcrypt from 'bcrypt';
import { AppError } from '../../errors/app-error.js';
import type { LoginInput, PublicUser, RegisterInput, StoredUser, UserStore } from './auth.types.js';
import type { TokenService } from './token.service.js';
import { toPublicUser } from './auth.types.js';
import type { OwnershipService } from './ownership.service.js';

// Cost-12 dummy hash makes unknown-email login still perform a bcrypt comparison.
// It is not a credential, user record or server-side session.
const dummyHash = '$2b$12$0kUxtm/qgb/ysSn8DzJpsOzqK8lFCIisjMHoXniekw.oti8jAwDjW';

export class AuthService {
  constructor(private readonly users: UserStore, private readonly tokens: TokenService, private readonly ownership?: OwnershipService) {}

  async register(input: RegisterInput) {
    if (!input.registrationToken || !this.ownership) throw new AppError(403, 'EMAIL_VERIFICATION_REQUIRED', 'Verify your email before creating an account.');
    return this.ownership.complete({ purpose: 'REGISTER', token: input.registrationToken, name: input.name, email: input.email, password: input.password, phone: input.phone });
  }

  async logout(userId: string) {
    if (!this.users.revokeSessions) throw new AppError(503, 'AUTH_TEMPORARILY_UNAVAILABLE', 'Sign-out is temporarily unavailable.');
    await this.users.revokeSessions(userId);
  }

  async login(input: LoginInput) {
    const authenticatedAtMs = Date.now();
    const user = await this.users.findByEmail(input.email);
    const matches = await bcrypt.compare(input.password, user?.passwordHash ?? dummyHash);
    if (!user || !user.passwordHash || !matches || user.authDisabledAt) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }
    if (!user.emailVerifiedAt || !Number.isInteger(user.authVersion)) throw new AppError(403, 'EMAIL_VERIFICATION_REQUIRED', 'Verify your email and existing password to restore access.');
    return this.authResponse(user, authenticatedAtMs, user.passwordHash);
  }

  async getMe(userId: string): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user) throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required.');
    return toPublicUser(user);
  }

  private authResponse(user: StoredUser | PublicUser, authenticatedAtMs?: number, passwordHash?: string) {
    return { user: toPublicUser(user), accessToken: this.tokens.sign({ userId: user.id, role: user.role, authVersion: (user as StoredUser).authVersion }, authenticatedAtMs, passwordHash), tokenType: 'Bearer' };
  }
}
