import type { PrismaClient } from '../../generated/prisma/client.js';
import type { SeatLockRedis } from '../seat-lock/seat-lock.types.js';
import { SeatLockService } from '../seat-lock/seat-lock.service.js';
import { BookingRepository } from './booking.repository.js';
import { BookingService } from './booking.service.js';

export function createBooking(prisma: PrismaClient, redis: SeatLockRedis) {
  return { bookings: new BookingService(new BookingRepository(prisma), new SeatLockService(redis)) };
}
