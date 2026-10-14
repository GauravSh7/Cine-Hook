import type { FinancialBookings } from '../booking/booking-gateway.js';
import type { PricingRepository } from './pricing.repository.js';
export class PricingService {
  constructor(private readonly repository: PricingRepository, private readonly bookings: FinancialBookings) {}
  quote(userId:string,id:string) { return this.repository.readOrChange(userId,id); }
  async coupon(userId:string,id:string,code:string|null) {
    await this.bookings.payable(userId,id);
    return this.repository.readOrChange(userId,id,code);
  }
}
