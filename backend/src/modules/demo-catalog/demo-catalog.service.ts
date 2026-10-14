import type { DemoListingKind, DemoListing } from '../../generated/prisma/client.js';
import { AppError } from '../../errors/app-error.js';
import type { DemoQuery, DemoStore, PublicDemoListing } from './demo-catalog.types.js';
function publicListing({ isActive: _active, createdAt: _created, updatedAt: _updated, ...listing }: DemoListing): PublicDemoListing {
  return { ...listing, isDemo: true, bookingAvailable: false };
}
export class DemoCatalogService {
  constructor(private readonly store: DemoStore) {}
  async list(query: DemoQuery) {
    const { cityId, ...filters } = query;
    const cityName = cityId ? await this.store.findCityName(cityId) : null;
    if (cityId && !cityName) throw new AppError(404, 'CITY_NOT_FOUND', 'City could not be found.');
    const cityFilters = cityName && query.kind !== 'STREAM' ? { ...filters, cityName } : filters;
    let rows = await this.store.list(cityFilters);
    // Keep the existing editorial cards visible when the selected city has no
    // local listing; bookable inventory remains separately city-filtered.
    if (rows.length === 0 && cityName && query.kind !== 'STREAM') rows = await this.store.list(filters);
    const items = rows.map(publicListing);
    return { items, page: query.page, limit: query.limit };
  }
  async get(kind: DemoListingKind, id: string) {
    const listing = await this.store.findActive(kind, id);
    if (!listing) throw new AppError(404, 'LISTING_NOT_FOUND', 'This experience could not be found.');
    return { listing: publicListing(listing) };
  }
}
