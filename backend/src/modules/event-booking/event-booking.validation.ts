import { z } from 'zod';
export const eventBookingCreateSchema = z.object({ eventSessionId: z.string().uuid().toLowerCase(),
  seatIds: z.array(z.string().uuid().toLowerCase()).min(1).max(10),
}).strict().refine(input => new Set(input.seatIds).size === input.seatIds.length);
