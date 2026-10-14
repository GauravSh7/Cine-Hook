export interface SeatLockRedis {
  sendCommand(args: readonly string[], options?: { timeout?: number; abortSignal?: AbortSignal }): Promise<unknown>;
}

export interface SeatLocks {
  acquire(showId: string, seatIds: string[], userId: string, holdId: string): Promise<{ expiresAt: Date }>;
  release(showId: string, seatIds: string[], userId: string, holdId: string): Promise<number>;
  validate(showId: string, seatIds: string[], userId: string, holdId: string): Promise<boolean>;
  inspect(showId: string, seatIds: string[]): Promise<Map<string, { locked: boolean; remainingMs: number }>>;
}
