import type { PrismaClient } from '../../generated/prisma/client.js';
import { EventRepository } from './event.repository.js';
import { EventService } from './event.service.js';
export function createEvents(prisma: PrismaClient) { return new EventService(new EventRepository(prisma)); }
