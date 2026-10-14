import { api } from './client'
export type TaxLine = {name:string;rateBps:number;amountPaise:number}
export interface PricingQuote {
  version:number;label:string;couponCode:string|null;subtotalPaise:number;discountPaise?:number;discountedPaise?:number;
  ticketBasePaise?:number;admissionTaxPaise?:number;feePaise?:number;feeTaxPaise?:number;totalPaise:number;
  taxes?:TaxLine[];feeTaxes?:TaxLine[];frozen:boolean;simulated?:boolean;paymentAllowed?:boolean;feeWaived?:boolean;feeOriginalPaise?:number
}
export const pricingApi = {
  quote:(id:string,signal?:AbortSignal)=>api<PricingQuote>(`/bookings/${encodeURIComponent(id)}/quote`,{signal}),
  coupon:(id:string,code:string|null)=>api<PricingQuote>(`/bookings/${encodeURIComponent(id)}/coupon`,{method:'PUT',body:{code}}),
}
