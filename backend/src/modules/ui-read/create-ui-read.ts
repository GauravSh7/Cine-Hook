import type { PrismaClient } from '../../generated/prisma/client.js';
import type { BookingServices } from '../booking/booking.types.js';
import { UiReadRepository } from './ui-read.repository.js';
import { UiReadService } from './ui-read.service.js';
import type { UiReadServices } from './ui-read.types.js';

export function createUiRead(prisma: PrismaClient, bookings: Pick<BookingServices['bookings'], 'getById'>): UiReadServices {
  return { reads: new UiReadService(new UiReadRepository(prisma), bookings) };
}
