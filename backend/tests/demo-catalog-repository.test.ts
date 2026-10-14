import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { DemoCatalogRepository } from '../src/modules/demo-catalog/demo-catalog.repository.js';

function setup() {
  const findMany = vi.fn().mockResolvedValue([]), findFirst = vi.fn().mockResolvedValue(null), findUnique = vi.fn().mockResolvedValue({ name: 'New Delhi' });
  return { repository: new DemoCatalogRepository({ demoListing: { findMany, findFirst }, city: { findUnique } } as unknown as PrismaClient), findMany, findFirst, findUnique };
}
describe('category repository scoped predicates', () => {
  it('restricts a detail read to its active kind and exact identity', async () => {
    const { repository, findFirst } = setup(); await repository.findActive('SPORTS', 'test-id');
    expect(findFirst).toHaveBeenCalledExactlyOnceWith({ where: { id: 'test-id', kind: 'SPORTS', isActive: true } });
  });
  it('resolves only an existing city name without reading or writing extra fields', async () => {
    const { repository, findUnique } = setup(); expect(await repository.findCityName('city-id')).toBe('New Delhi');
    expect(findUnique).toHaveBeenCalledExactlyOnceWith({ where: { id: 'city-id' }, select: { name: true } });
  });
  it('keeps city equality, activity filters and bounded stable pagination in one read', async () => {
    const { repository, findMany } = setup(); await repository.list({ kind: 'ACTIVITIES', cityName: 'Mumbai', category: 'Workshops', page: 2, limit: 6 });
    expect(findMany).toHaveBeenCalledExactlyOnceWith({ where: { kind: 'ACTIVITIES', isActive: true, cityName: { equals: 'Mumbai', mode: 'insensitive' }, category: 'Workshops' }, orderBy: [{ title: 'asc' }, { id: 'asc' }], skip: 6, take: 6 });
  });
  it('treats wildcard characters as literal search rather than unrestricted matches', async () => {
    const { repository, findMany } = setup(); await repository.list({ kind: 'EVENTS', search: 'A%_B', page: 1, limit: 20 });
    expect(findMany.mock.calls[0]![0].where.title).toEqual({ contains: 'A\\%\\_B', mode: 'insensitive' });
  });
});
