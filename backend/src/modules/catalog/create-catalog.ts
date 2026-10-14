import type { PrismaClient } from '../../generated/prisma/client.js';
import { MovieRepository } from './movie.repository.js';
import { CityRepository } from './city.repository.js';
import { TheatreRepository } from './theatre.repository.js';
import { ScreenRepository } from './screen.repository.js';
import { MovieService } from './movie.service.js';
import { CityService } from './city.service.js';
import { TheatreService } from './theatre.service.js';
import { ScreenService } from './screen.service.js';
import type { CatalogServices } from './catalog.types.js';

export function createCatalog(prisma: PrismaClient): CatalogServices {
  const cities = new CityService(new CityRepository(prisma));
  const theatres = new TheatreService(new TheatreRepository(prisma), cities);
  return { movies: new MovieService(new MovieRepository(prisma)), cities, theatres,
    screens: new ScreenService(new ScreenRepository(prisma), theatres) };
}
