import 'dotenv/config';
import { createShutdown } from './lib/lifecycle.js';
import { dependencyErrorDetails } from './lib/dependency-diagnostics.js';
import { AuthRateLimiter } from './modules/auth/auth-rate-limit.js';
import { logDependencyFailure } from './lib/dependency-diagnostics.js';
import { PricingRepository } from './modules/pricing/pricing.repository.js';
import { PricingService } from './modules/pricing/pricing.service.js';
import { createApp } from './app.js';
import { parseConfig, ConfigurationError } from './config/env.js';
import { createPrisma } from './lib/prisma.js';
import { createRedis } from './lib/redis.js';
import { HealthRepository } from './modules/health/health.repository.js';
import { HealthService } from './modules/health/health.service.js';
import { UserRepository } from './modules/auth/user.repository.js';
import { AuthService } from './modules/auth/auth.service.js';
import { TokenService } from './modules/auth/token.service.js';
import { createCatalog } from './modules/catalog/create-catalog.js';
import { createShows } from './modules/shows/create-shows.js';
import { createBooking } from './modules/booking/create-booking.js';
import { createPayments } from './modules/payments/create-payments.js';
import { createUiRead } from './modules/ui-read/create-ui-read.js';
import { createAccount } from './modules/account/create-account.js';
import { createWishlist } from './modules/wishlist/create-wishlist.js';
import { GoogleAuthService } from './modules/auth/google/google.service.js';
import { GoogleUserRepository } from './modules/auth/google/google.repository.js';
import { GoogleIdTokenVerifier } from './modules/auth/google/google.verifier.js';
import { GoogleChallenge } from './modules/auth/google/google.challenge.js';
import { DemoCatalogRepository } from './modules/demo-catalog/demo-catalog.repository.js';
import { DemoCatalogService } from './modules/demo-catalog/demo-catalog.service.js';
import { createEvents } from './modules/events/create-events.js';
import { createEventBooking } from './modules/event-booking/create-event-booking.js';
import { BookingGateway } from './modules/booking/booking-gateway.js';
import { BookingTargetRepository } from './modules/booking/booking-target.repository.js';
import { PasswordResetStore } from './modules/auth/password-reset.store.js';
import { BrevoRecoveryMailer } from './modules/auth/password-reset.mailer.js';
import { OwnershipRepository } from './modules/auth/ownership.repository.js';
import { OwnershipProofStore } from './modules/auth/ownership-proof.store.js';
import { OwnershipService } from './modules/auth/ownership.service.js';

function start() {
const config = parseConfig(process.env);
const databaseTarget = new URL(config.databaseUrl);
const razorpayTestCheckout = config.devRazorpayTestCheckout || config.stagingRazorpayTestCheckout;
const previewContext = config.nodeEnv === 'development' && ['localhost','127.0.0.1','[::1]'].includes(databaseTarget.hostname)
  && databaseTarget.pathname === '/cinehook_dev' && (!databaseTarget.port || databaseTarget.port === '5432');
const prisma = createPrisma(config.databaseUrl);
const pricing = new PricingRepository(prisma,razorpayTestCheckout?'razorpay-test':previewContext?'development-preview':'verified',razorpayTestCheckout?process.env:undefined);
const redis = createRedis(config.redisUrl);
const ownershipUsers = new OwnershipRepository(prisma);
const recoveryStore = new PasswordResetStore(redis);
const tokens = new TokenService({ secret: config.jwtSecret, expiresInSeconds: config.jwtExpiresInSeconds,
  sessions: recoveryStore, currentAuth: id => ownershipUsers.authSnapshot(id) });
const ownership = new OwnershipService(ownershipUsers, new OwnershipProofStore(redis, config.jwtSecret, config.ownershipProofLimits), tokens,
  { secret: config.jwtSecret, mailer: config.passwordResetMail ? new BrevoRecoveryMailer(config.passwordResetMail) : undefined });
const eventBooking = createEventBooking(prisma, redis);
const booking = { bookings: new BookingGateway(new BookingTargetRepository(prisma), createBooking(prisma, redis).bookings, eventBooking) };
const app = createApp({ frontendOrigin: config.frontendOrigin,
  maintenanceMode: config.maintenanceMode,
  authTrustedProxyCidrs: config.authTrustedProxyCidrs,
  authRateLimiter: new AuthRateLimiter(redis, config.jwtSecret, config.authApiGlobalLimit),
  catalogueStage: { databaseUrl: config.databaseUrl, staging: config.stagingCatalogueMode, testPaymentsAllowed: config.stagingRazorpayTestCheckout },
  healthService: new HealthService(new HealthRepository(prisma, redis)),
  auth: { service: new AuthService(new UserRepository(prisma), tokens, ownership), tokens, ownership,
    google: config.googleClientId ? {
      service: new GoogleAuthService(new GoogleUserRepository(prisma), new GoogleIdTokenVerifier(config.googleClientId), tokens, config.googleClientId),
      challenge: new GoogleChallenge({ secret: config.jwtSecret, clientId: config.googleClientId, origin: config.frontendOrigin, secure: config.nodeEnv === 'production' }),
    } : undefined },
  catalog: createCatalog(prisma),
  demoCatalog: new DemoCatalogService(new DemoCatalogRepository(prisma)),
  events: createEvents(prisma),
  shows: createShows(prisma),
  booking,
  pricing: new PricingService(pricing, booking.bookings),
  eventBooking,
  uiRead: createUiRead(prisma, booking.bookings),
  account: createAccount(prisma, config.cloudinary),
  wishlist: createWishlist(prisma),
  payments: createPayments(prisma, booking.bookings, config.razorpay,razorpayTestCheckout?pricing:undefined, !config.stagingCatalogueMode || config.stagingRazorpayTestCheckout),
});

// Availability is reported by readiness. Liveness stays usable during outages.
void redis.connect().catch(error => logDependencyFailure('redis_connect_failed', 'redis', error));
const server = app.listen(config.port, () => {
  console.info(JSON.stringify({ event: 'server_started', port: config.port }));
});

const shutdown = createShutdown(server,async()=>{
  const results=await Promise.allSettled([prisma.$disconnect(),Promise.resolve().then(()=>{if(redis.isOpen)redis.destroy();})]);
  const rejected=results.find(result=>result.status==='rejected');
  if(rejected?.status==='rejected')throw rejected.reason;
},{exit:code=>process.exit(code)});
server.on('error', error => {
  console.error(JSON.stringify({ event: 'server_failed',...dependencyErrorDetails(error) }));
  shutdown('server_error',1);
});
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException',error=>{console.error(JSON.stringify({event:'uncaught_exception',...dependencyErrorDetails(error)}));shutdown('uncaught_exception',1);});
process.on('unhandledRejection',error=>{console.error(JSON.stringify({event:'unhandled_rejection',...dependencyErrorDetails(error)}));shutdown('unhandled_rejection',1);});
}
try{start();}catch(error){console.error(JSON.stringify({event:'startup_failed',...dependencyErrorDetails(error),
  ...(error instanceof ConfigurationError?{fields:error.fields}:{})}));process.exitCode=1;}
