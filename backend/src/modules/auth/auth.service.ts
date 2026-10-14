import bcrypt from 'bcrypt';
import { AppError } from '../../errors/app-error.js';
import type { LoginInput, PublicUser, RegisterInput, StoredUser, UserStore } from './auth.types.js';
import type { TokenService } from './token.service.js';
import { toPublicUser } from './auth.types.js';

// Cost-12 dummy hash makes unknown-email login still perform a bcrypt comparison.
// It is not a credential, user record or server-side session.
const dummyHash = '$2b$12$0kUxtm/qgb/ysSn8DzJpsOzqK8lFCIisjMHoXniekw.oti8jAwDjW';

export class AuthService {
  constructor(private readonly users: UserStore, private readonly tokens: TokenService) {}

  async register(input: RegisterInput) {
    if (await this.users.findByEmail(input.email)) {
      throw new AppError(409, 'EMAIL_EXISTS', 'Email is already registered.');
    }
    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await this.users.create({ name: input.name, email: input.email, passwordHash });
    return this.authResponse(user);
  }

  async login(input: LoginInput) {
    const user = await this.users.findByEmail(input.email);
    const matches = await bcrypt.compare(input.password, user?.passwordHash ?? dummyHash);
    if (!user || !user.passwordHash || !matches) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }
    return this.authResponse(user);
  }

  async getMe(userId: string): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user) throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required.');
    return toPublicUser(user);
  }

  private authResponse(user: StoredUser | PublicUser) {
    return { user: toPublicUser(user), accessToken: this.tokens.sign({ userId: user.id, role: user.role }), tokenType: 'Bearer' };
  }
}
