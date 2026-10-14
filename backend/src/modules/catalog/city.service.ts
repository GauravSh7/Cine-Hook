import { AppError } from '../../errors/app-error.js';
import type { CityInput, CityQuery, CityStore } from './catalog.types.js';

export class CityService {
  constructor(private readonly cities: CityStore) {}
  async list(query: CityQuery) { return { items: await this.cities.list(query), page: query.page, limit: query.limit }; }
  async getById(id: string) {
    const city = await this.cities.findById(id);
    if (!city) throw new AppError(404, 'NOT_FOUND', 'City not found.');
    return city;
  }
  create(input: CityInput) { return this.cities.create(input); }
}
