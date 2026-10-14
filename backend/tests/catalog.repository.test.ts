import { expect, it, vi } from 'vitest';
import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';
import { MovieRepository } from '../src/modules/catalog/movie.repository.js';
import { CityRepository } from '../src/modules/catalog/city.repository.js';
import { TheatreRepository } from '../src/modules/catalog/theatre.repository.js';
import { databaseWrite } from '../src/modules/catalog/database-write.js';

it('emits all movie filters, active-only predicate, stable order and bounded offset', async () => {
  const findMany = vi.fn(async () => []);
  const prisma = { movie: { findMany } } as unknown as PrismaClient;
  await new MovieRepository(prisma).list({ search: 'Space', language: 'english', genre: 'drama', page: 3, limit: 10 });
  expect(findMany).toHaveBeenCalledWith({ where: { isActive: true, title: { contains: 'Space', mode: 'insensitive' }, language: 'english', genres: { has: 'drama' } },
    include: { shows: { where: { status: 'SCHEDULED', startsAt: { gt: expect.any(Date) }, screen: { theatre: { cityId: undefined } } }, select: { id: true,startsAt:true }, orderBy:{startsAt:'asc'},take: 1 } },
    orderBy: [{ title: 'asc' }, { id: 'asc' }], skip: 20, take: 10 });
});
it('selected cities require an actual upcoming screening, not only a catalogue entry',async()=>{
  const findMany=vi.fn(async()=>[]),prisma={movie:{findMany}} as unknown as PrismaClient;
  await new MovieRepository(prisma).list({cityId:'supported-city',page:1,limit:20});
  expect(findMany.mock.calls[0]?.[0]).toMatchObject({where:{shows:{some:{status:'SCHEDULED',startsAt:{gt:expect.any(Date)},screen:{theatre:{cityId:'supported-city'}}}}}});
});
it('escapes SQL LIKE wildcards so a search is a literal substring', async () => {
  const findMany = vi.fn(async () => []);
  const prisma = { movie: { findMany } } as unknown as PrismaClient;
  await new MovieRepository(prisma).list({ search: '100%_\\', page: 1, limit: 20 });
  expect(findMany.mock.calls[0]?.[0]).toMatchObject({ where: { title: { contains: '100\\%\\_\\\\' } } });
});
it('emits the selected city filter for theatres', async () => {
  const findMany = vi.fn(async () => []);
  const prisma = { theatre: { findMany } } as unknown as PrismaClient;
  await new TheatreRepository(prisma).list({ cityId: 'city-id', page: 1, limit: 20 });
  expect(findMany.mock.calls[0]?.[0]).toMatchObject({ where: { cityId: 'city-id' }, take: 20, skip: 0 });
});
it('searches city names and states, prioritizing cities with real cinema inventory', async () => {
  const findMany = vi.fn(async () => []);
  const prisma = { city: { findMany } } as unknown as PrismaClient;
  await new CityRepository(prisma).list({ search: 'Muzaffarnagar', state: 'Uttar Pradesh', page: 1, limit: 30 });
  expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { countryCode: 'IN', state: { equals: 'Uttar Pradesh', mode: 'insensitive' }, OR: [
    { name: { contains: 'Muzaffarnagar', mode: 'insensitive' } }, { state: { contains: 'Muzaffarnagar', mode: 'insensitive' } },
  ] }, skip: 0, take: 30 }));
});
it.each([['P2002', 409, 'DUPLICATE_RESOURCE'], ['P2003', 409, 'PARENT_CONFLICT'], ['P2025', 404, 'NOT_FOUND']])(
  'maps %s without exposing database details', async (code, status, safeCode) => {
    const failure = new Prisma.PrismaClientKnownRequestError('private connection details', { code, clientVersion: '7.10.0' });
    await expect(databaseWrite(async () => { throw failure; }, 'Theatre')).rejects.toMatchObject({ status, code: safeCode });
  },
);
it('does not relabel unrelated failures', async () => {
  const failure = new Error('network failure');
  await expect(databaseWrite(async () => { throw failure; }, 'Movie')).rejects.toBe(failure);
});
