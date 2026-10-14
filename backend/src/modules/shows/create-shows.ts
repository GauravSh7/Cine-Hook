import type { PrismaClient } from '../../generated/prisma/client.js';
import type { ShowServices } from './show.types.js';
import { ShowRepository } from './show.repository.js';
import { ShowService } from './show.service.js';
import { SeatRepository } from './seat.repository.js';
import { SeatService } from './seat.service.js';

export function createShows(prisma: PrismaClient): ShowServices {
  return { shows: new ShowService(new ShowRepository(prisma)), seats: new SeatService(new SeatRepository(prisma)) };
}
