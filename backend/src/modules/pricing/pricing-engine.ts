import { AppError } from '../../errors/app-error.js';

export type TaxPolicy = {
  feeWaiverStartsAt?: string;
  simulation?: {kind:'DEVELOPMENT_TEST';bracketRule:'ORIGINAL_INCLUSIVE_TICKET'|'FLAT_ADMISSION_18';discountFunding:'SUPPLIER';feeClassification:'998554'};
  classification: 'CINEMA' | 'ADMISSION_18' | 'RECOGNISED_SPORT' | 'IPL_LIKE' | 'EXEMPT';
  effectiveFrom: string; effectiveTo: string | null; verified: boolean; source: string;
  supplierState: string; supplyState: string; feeSupplierState: string; feeSupplyState: string;
  feeRateBps: number; feeSource: string; feeVerified: boolean;
};
export type TaxLine = { name: string; rateBps: number; amountPaise: number };
export type Quote = ReturnType<typeof calculateQuote>;
const round = (n: bigint, d: bigint) => (n + d / 2n) / d;
const num = (n: bigint) => { if (n < 0n || n > BigInt(Number.MAX_SAFE_INTEGER)) throw new AppError(409,'PRICE_INVALID','Ticket prices cannot be calculated.'); return Number(n); };
function splitTax(amount: number, rate: number, supplier: string, supply: string): TaxLine[] {
  if (!amount) return [];
  if (supplier !== supply) return [{name:'IGST',rateBps:rate,amountPaise:amount}];
  const cgst = Math.floor(amount / 2);
  return [{name:'CGST',rateBps:rate/2,amountPaise:cgst},{name:'SGST',rateBps:rate/2,amountPaise:amount-cgst}];
}
export type PricingContext = 'verified' | 'development-preview' | 'controlled-test' | 'razorpay-test';
export function calculateQuote(input: Array<{id:string;price:number}>, code: string | null, policy: TaxPolicy, now: Date, context: PricingContext = 'verified', bookingCreatedAt?: Date) {
  if (code !== null && code !== 'FIRST50' && code !== 'SAVE10') throw new AppError(400,'COUPON_INVALID','This coupon is not valid.');
  const simulated = policy.simulation !== undefined;
  const authorized = simulated ? context !== 'verified' && policy.verified === false && policy.feeVerified === false
    && policy.simulation?.kind === 'DEVELOPMENT_TEST'
    && ((policy.classification==='CINEMA'&&policy.simulation.bracketRule==='ORIGINAL_INCLUSIVE_TICKET')
      ||(policy.classification==='ADMISSION_18'&&policy.simulation.bracketRule==='FLAT_ADMISSION_18')) && policy.simulation.discountFunding === 'SUPPLIER'
    && policy.simulation.feeClassification === '998554' && policy.feeRateBps === 1800 : policy.verified && policy.feeVerified;
  if (!authorized || (policy.feeWaiverStartsAt !== undefined && (!simulated || !Number.isFinite(Date.parse(policy.feeWaiverStartsAt)))) || !policy.source || !policy.feeSource || now.getTime()<Date.parse('2025-09-22T00:00:00+05:30') || !/^\d{2}$/.test(policy.supplierState) || !/^\d{2}$/.test(policy.supplyState)
    || !/^\d{2}$/.test(policy.feeSupplierState) || !/^\d{2}$/.test(policy.feeSupplyState)
    || !Number.isInteger(policy.feeRateBps) || policy.feeRateBps < 0 || policy.feeRateBps > 4000
    || !Number.isFinite(Date.parse(policy.effectiveFrom)) || now.getTime() < Date.parse(policy.effectiveFrom)
    || (policy.effectiveTo !== null && (!Number.isFinite(Date.parse(policy.effectiveTo)) || now.getTime() >= Date.parse(policy.effectiveTo)))) {
    throw new AppError(409,'TAX_CONFIGURATION_REQUIRED','Checkout is unavailable until tax settings are verified.');
  }
  if (!input.length || input.some(t => !Number.isSafeInteger(t.price) || t.price <= 0)) throw new AppError(409,'PRICE_INVALID','Ticket prices cannot be calculated.');
  const sorted = [...input].sort((a,b)=>a.id.localeCompare(b.id));
  const subtotal = sorted.reduce((n,t)=>n+BigInt(t.price),0n);
  const discount = code === 'FIRST50' ? round(subtotal,2n) : code === 'SAVE10' ? (round(subtotal,10n)>10000n ? 10000n:round(subtotal,10n)) : 0n;
  // Largest remainder allocation, stable by ticket ID. No floating point or lost paise.
  const allocations = sorted.map(t=>({ticket:t,discount:discount*BigInt(t.price)/subtotal,remainder:discount*BigInt(t.price)%subtotal}));
  let left = discount-allocations.reduce((n,t)=>n+t.discount,0n);
  const priority = [...allocations].sort((a,b)=>a.remainder>b.remainder?-1:a.remainder<b.remainder?1:a.ticket.id.localeCompare(b.ticket.id));
  for (const t of priority) { if (!left) break; t.discount++; left--; }
  const tickets = allocations.map(({ticket,discount:d})=>{
    const inclusive = BigInt(ticket.price)-d;
    let rate: number;
    switch(policy.classification) {
      // Simulation only: classify the ORIGINAL inclusive ticket, then extract
      // that rate from the discounted price. This is not a legal determination.
      case 'CINEMA': rate = (simulated ? BigInt(ticket.price) : inclusive)<=10000n ? 500:1800; break;
      case 'RECOGNISED_SPORT': rate = inclusive<=50000n ? 0:1800; break;
      case 'ADMISSION_18': rate=1800; break;
      case 'IPL_LIKE': rate=4000; break;
      case 'EXEMPT': rate=0; break;
      default: throw new AppError(409,'TAX_CONFIGURATION_REQUIRED','Admission classification needs verification.');
    }
    const tax = round(inclusive*BigInt(rate),BigInt(10000+rate));
    return {id:ticket.id,originalPaise:ticket.price,discountPaise:num(d),inclusivePaise:num(inclusive),rateBps:rate,basePaise:num(inclusive-tax),taxPaise:num(tax)};
  });
  const admissionTax = tickets.reduce((n,t)=>n+t.taxPaise,0);
  const taxes = tickets.flatMap(t=>splitTax(t.taxPaise,t.rateBps,policy.supplierState,policy.supplyState));
  const feeWaived = simulated && !!policy.feeWaiverStartsAt && !!bookingCreatedAt
    && bookingCreatedAt.getTime() >= Date.parse(policy.feeWaiverStartsAt) && now.getTime() >= Date.parse(policy.feeWaiverStartsAt);
  const fee = feeWaived ? 0 : 700, feeTax = num(round(BigInt(fee)*BigInt(policy.feeRateBps),10000n));
  return {version:1, label:simulated ? 'Simulated order summary — not a GST tax invoice' : 'Order summary',simulated,
    paymentAllowed: !simulated || context === 'controlled-test' || context === 'razorpay-test',couponCode:code,subtotalPaise:num(subtotal),discountPaise:num(discount),discountedPaise:num(subtotal-discount),
    ticketBasePaise:tickets.reduce((n,t)=>n+t.basePaise,0),admissionTaxPaise:admissionTax,tickets,taxes,
    feePaise:fee,feeOriginalPaise:700,feeWaived,feeTaxPaise:feeTax,feeTaxes:splitTax(feeTax,policy.feeRateBps,policy.feeSupplierState,policy.feeSupplyState),
    totalPaise:num(subtotal-discount+BigInt(fee)+BigInt(feeTax)),policy,calculatedAt:now.toISOString()};
}
