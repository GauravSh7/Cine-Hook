import type { PrismaClient } from '../../generated/prisma/client.js';
import type { SeatLockRedis } from '../seat-lock/seat-lock.types.js';
import { SeatLockService } from '../seat-lock/seat-lock.service.js';
import { EventBookingRepository } from './event-booking.repository.js';
import { EventBookingService } from './event-booking.service.js';

export function createEventBooking(prisma: PrismaClient, redis: SeatLockRedis) {
  return new EventBookingService(new EventBookingRepository(prisma), new SeatLockService(redis, 'event'));
}
