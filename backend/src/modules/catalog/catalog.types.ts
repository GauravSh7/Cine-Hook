import type { Movie, City, Theatre, Screen } from '../../generated/prisma/client.js';
import type { MovieService } from './movie.service.js';
import type { CityService } from './city.service.js';
import type { TheatreService } from './theatre.service.js';
import type { ScreenService } from './screen.service.js';
import type { MovieRead } from './public-movie.js';

export type MovieInput = Pick<Movie, 'title' | 'description' | 'durationMinutes' | 'releaseDate' | 'language' | 'genres' | 'posterUrl'> & Partial<Pick<Movie, 'backdropUrl' | 'collections'>>;
export type CityInput = Pick<City, 'name' | 'state' | 'countryCode'>;
export type TheatreInput = Pick<Theatre, 'name' | 'address' | 'cityId'>;
export type ScreenInput = Pick<Screen, 'name' | 'capacity' | 'theatreId'>;
export type Page = { page: number; limit: number };
export type CityQuery = Page & { search?: string; state?: string };
export type MovieQuery = Page & { search?: string; language?: string; genre?: string; cityId?: string };
export type TheatreQuery = Page & { cityId?: string };
export type TheatreDetail = Theatre & { city: City; screens: Screen[] };
export interface MovieStore {
  list(query: MovieQuery): Promise<MovieRead[]>;
  findById(id: string, cityId?: string): Promise<MovieRead | null>;
  showDates(id: string, cityId?: string): Promise<Date[]>;
  create(input: MovieInput): Promise<Movie>;
  update(id: string, input: Partial<MovieInput> & { isActive?: false }): Promise<Movie>;
}
export interface CityStore {
  list(query: CityQuery): Promise<City[]>;
  findById(id: string): Promise<City | null>;
  create(input: CityInput): Promise<City>;
}
export interface TheatreStore {
  list(query: TheatreQuery): Promise<Theatre[]>;
  findById(id: string): Promise<TheatreDetail | null>;
  create(input: TheatreInput): Promise<Theatre>;
  update(id: string, input: Partial<TheatreInput>): Promise<Theatre>;
}
export interface ScreenStore {
  create(input: ScreenInput): Promise<Screen>;
  update(id: string, input: Partial<ScreenInput>): Promise<Screen>;
}
export interface CatalogServices {
  movies: MovieService; cities: CityService; theatres: TheatreService; screens: ScreenService;
}
