import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import type { LayoutContext, SeatInput, SeatStore } from './show.types.js';
import { schedulingWrite } from './scheduling-write.js';

const orderBy = [{ rowName: 'asc' as const }, { seatNumber: 'asc' as const }];
export class SeatRepository implements SeatStore {
  constructor(private readonly prisma: PrismaClient) {}

  async list(screenId: string) {
    const [screen, seats] = await this.prisma.$transaction([
      this.prisma.screen.findUnique({ where: { id: screenId } }),
      this.prisma.seat.findMany({ where: { screenId }, orderBy }),
    ]);
    return { screen, seats };
  }

  initialize(screenId: string, seats: SeatInput[], validate: (context: LayoutContext) => void) {
    return schedulingWrite(() => this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM screens WHERE id = ${screenId}::uuid FOR UPDATE`);
      const screen = await tx.screen.findUnique({ where: { id: screenId } });
      const existing = await tx.seat.findMany({ where: { screenId }, orderBy });
      const showCount = await tx.show.count({ where: { screenId } });
      validate({ screen, seats: existing, showCount });
      await tx.seat.createMany({ data: seats.map(seat => ({ ...seat, screenId })) });
      return tx.seat.findMany({ where: { screenId }, orderBy });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }));
  }
}
