import type { DemoListing, DemoListingKind } from '../../generated/prisma/client.js';
export type DemoQuery = { kind: DemoListingKind; cityId?: string; category?: string; search?: string; page: number; limit: number };
export type DemoStoreQuery = Omit<DemoQuery, 'cityId'> & { cityName?: string };
export type PublicDemoListing = Omit<DemoListing, 'isActive' | 'createdAt' | 'updatedAt'> & { isDemo: true; bookingAvailable: false };
export interface DemoStore {
  list(query: DemoStoreQuery): Promise<DemoListing[]>;
  findActive(kind: DemoListingKind, id: string): Promise<DemoListing | null>;
  findCityName(id: string): Promise<string | null>;
}
export interface DemoCatalog {
  list(query: DemoQuery): Promise<{ items: PublicDemoListing[]; page: number; limit: number }>;
  get(kind: DemoListingKind, id: string): Promise<{ listing: PublicDemoListing }>;
}
