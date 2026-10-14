import express from 'express';
import { pricingRoutes } from './modules/pricing/pricing.routes.js';
import type { PricingService } from './modules/pricing/pricing.service.js';
import cors from 'cors';
import helmet from 'helmet';
import { AppError } from './errors/app-error.js';
import { requestId } from './middleware/request-id.js';
import { errorHandler } from './middleware/error-handler.js';
import { healthRoutes } from './modules/health/health.routes.js';
import type { HealthService } from './modules/health/health.service.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import type { AuthService } from './modules/auth/auth.service.js';
import type { TokenService } from './modules/auth/token.service.js';
import type { CatalogServices } from './modules/catalog/catalog.types.js';
import { catalogRoutes } from './modules/catalog/catalog.routes.js';
import type { ShowServices } from './modules/shows/show.types.js';
import { showRoutes } from './modules/shows/show.routes.js';
import type { BookingServices } from './modules/booking/booking.types.js';
import { bookingRoutes } from './modules/booking/booking.routes.js';
import type { PaymentServices } from './modules/payments/payment.types.js';
import { paymentRoutes, razorpayWebhookRoutes } from './modules/payments/payment.routes.js';
import { refundRoutes } from './modules/refunds/refund.routes.js';
import { uiReadRoutes } from './modules/ui-read/ui-read.routes.js';
import type { UiReadServices } from './modules/ui-read/ui-read.types.js';
import { accountRoutes } from './modules/account/account.routes.js';
import type { AccountService } from './modules/account/account.service.js';
import { wishlistRoutes } from './modules/wishlist/wishlist.routes.js';
import type { WishlistService } from './modules/wishlist/wishlist.service.js';
import type { GoogleAuth } from './modules/auth/google/google.routes.js';
import { googleRequest } from './modules/auth/google/google.middleware.js';
import { demoCatalogRoutes } from './modules/demo-catalog/demo-catalog.routes.js';
import type { DemoCatalog } from './modules/demo-catalog/demo-catalog.types.js';
import type { EventCatalog } from './modules/events/event.types.js';
import { eventRoutes } from './modules/events/event.routes.js';
import { eventBookingRoutes } from './modules/event-booking/event-booking.routes.js';
import type { EventBookingService } from './modules/event-booking/event-booking.service.js';

export function createApp(dependencies: {
  frontendOrigin: string;
  healthService: HealthService;
  auth: { service: AuthService; tokens: TokenService; google?: GoogleAuth };
  catalog: CatalogServices;
  shows?: ShowServices;
  booking?: BookingServices;
  payments?: PaymentServices;
  pricing?: PricingService;
  uiRead?: UiReadServices;
  account?: AccountService;
  wishlist?: WishlistService;
  demoCatalog?: DemoCatalog;
  events?: EventCatalog;
  eventBooking?: EventBookingService;
}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestId);
  app.use(helmet());
  app.use(cors({ origin: [dependencies.frontendOrigin], credentials: true }));
  // Signature verification requires original bytes; never JSON-parse first.
  if (dependencies.payments) app.use('/api/webhooks', razorpayWebhookRoutes(dependencies.payments));
  // Origin/content checks and challenge clearing precede the JSON parser so
  // trusted malformed submissions also abandon their browser challenge.
  app.use('/api/auth/google', googleRequest(dependencies.frontendOrigin, dependencies.auth.google?.challenge));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/health', healthRoutes(dependencies.healthService));
  if (dependencies.demoCatalog) app.use('/api/demo-catalog', demoCatalogRoutes(dependencies.demoCatalog));
  if (dependencies.events) app.use('/api', eventRoutes(dependencies.events));
  if (dependencies.booking || dependencies.eventBooking) app.use('/api', eventBookingRoutes(dependencies.eventBooking, dependencies.auth));
  app.use('/api/auth', authRoutes(dependencies.auth.service, dependencies.auth.tokens, dependencies.frontendOrigin, dependencies.auth.google));
  if (dependencies.account) app.use('/api/account', accountRoutes(dependencies.account, dependencies.auth));
  if (dependencies.wishlist) app.use('/api/wishlist', wishlistRoutes(dependencies.wishlist, dependencies.auth));
  if (dependencies.uiRead) app.use('/api', uiReadRoutes(dependencies.uiRead, dependencies.auth));
  if (dependencies.payments) app.use('/api/payments', paymentRoutes(dependencies.payments, dependencies.auth));
  if (dependencies.pricing) app.use('/api', pricingRoutes(dependencies.pricing, dependencies.auth));
  if (dependencies.payments?.refunds) app.use('/api', refundRoutes(dependencies.payments.refunds, dependencies.auth));
  if (dependencies.booking) app.use('/api', bookingRoutes(dependencies.booking, dependencies.auth,
    dependencies.payments?.refunds ? (userId,id)=>dependencies.payments!.refunds!.cancelCheckout(userId,id) : undefined));
  if (dependencies.shows) app.use('/api', showRoutes(dependencies.shows, dependencies.auth));
  app.use('/api', catalogRoutes(dependencies.catalog, dependencies.auth));
  app.use((_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Route not found.')));
  app.use(errorHandler);
  return app;
}
