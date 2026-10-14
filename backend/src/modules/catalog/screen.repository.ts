import type { PrismaClient } from '../../generated/prisma/client.js';
import type { ScreenInput, ScreenStore } from './catalog.types.js';
import { databaseWrite } from './database-write.js';
import { schedulingWrite } from '../shows/scheduling-write.js';

export class ScreenRepository implements ScreenStore {
  constructor(private readonly prisma: PrismaClient) {}
  create(input: ScreenInput) { return databaseWrite(() => this.prisma.screen.create({ data: input }), 'Screen'); }
  update(id: string, input: Partial<ScreenInput>) { return schedulingWrite(() => this.prisma.screen.update({ where: { id }, data: input })); }
}
