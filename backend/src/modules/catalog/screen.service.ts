import type { ScreenInput, ScreenStore } from './catalog.types.js';
import type { TheatreService } from './theatre.service.js';

export class ScreenService {
  constructor(private readonly screens: ScreenStore, private readonly theatres: TheatreService) {}
  async create(input: ScreenInput) { await this.theatres.getById(input.theatreId); return this.screens.create(input); }
  async update(id: string, input: Partial<ScreenInput>) {
    if (input.theatreId) await this.theatres.getById(input.theatreId);
    return this.screens.update(id, input);
  }
}
