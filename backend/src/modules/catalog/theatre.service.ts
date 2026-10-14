import { AppError } from '../../errors/app-error.js';
import type { TheatreInput, TheatreQuery, TheatreStore } from './catalog.types.js';
import type { CityService } from './city.service.js';

export class TheatreService {
  constructor(private readonly theatres: TheatreStore, private readonly cities: CityService) {}
  async list(query: TheatreQuery) { return { items: await this.theatres.list(query), page: query.page, limit: query.limit }; }
  async getById(id: string) {
    const theatre = await this.theatres.findById(id);
    if (!theatre) throw new AppError(404, 'NOT_FOUND', 'Theatre not found.');
    return theatre;
  }
  async create(input: TheatreInput) { await this.cities.getById(input.cityId); return this.theatres.create(input); }
  async update(id: string, input: Partial<TheatreInput>) {
    if (input.cityId) await this.cities.getById(input.cityId);
    return this.theatres.update(id, input);
  }
}
