import type { City, Movie, Screen, Seat, SeatType, Show, ShowSeatPrice, Theatre } from '../../generated/prisma/client.js';
import type { Page } from '../catalog/catalog.types.js';
import type { ShowService } from './show.service.js';
import type { SeatService } from './seat.service.js';

export type SeatInput = Pick<Seat, 'rowName' | 'seatNumber' | 'seatType'>;
export type PriceInput = { seatType: SeatType; pricePaise: number };
export type ShowInput = { movieId: string; screenId: string; startsAt: Date; prices: PriceInput[] };
export type ShowQuery = Page & { movieId?: string; cityId?: string; theatreId?: string; date?: Date; localDate?: Date };
export type ShowDetail = Show & {
  movie: Movie;
  screen: Screen & { theatre: Theatre & { city: City } };
  prices: ShowSeatPrice[];
};
export type ScheduleContext = { movie: Movie | null; screen: Screen | null; seats: Seat[] };
export type PreparedShow = { startsAt: Date; endsAt: Date; prices: PriceInput[] };
export type LayoutContext = { screen: Screen | null; seats: Seat[]; showCount: number };

export interface ShowStore {
  list(query: ShowQuery, asOf: Date): Promise<ShowDetail[]>;
  findById(id: string): Promise<ShowDetail | null>;
  listSeats(screenId: string): Promise<Seat[]>;
  schedule(input: ShowInput, prepare: (context: ScheduleContext) => PreparedShow): Promise<ShowDetail>;
}
export interface SeatStore {
  list(screenId: string): Promise<{ screen: Screen | null; seats: Seat[] }>;
  initialize(screenId: string, seats: SeatInput[], validate: (context: LayoutContext) => void): Promise<Seat[]>;
}
export interface ShowServices { shows: ShowService; seats: SeatService }
