import { describe, expect, it } from 'vitest';
import { calculateQuote } from './pricing-engine.js';

const policy = { classification: 'CINEMA', effectiveFrom: '2025-09-22T00:00:00+05:30', effectiveTo: null,
  supplierState: '29', supplyState: '29', source: 'Notification 15/2025-CTR', verified: true,
  feeRateBps: 1800, feeSource:'Isolated fee classification fixture',feeVerified:true,feeSupplierState: '29', feeSupplyState: '29' } as const;
const quote = (prices: number[], code: string | null = null) => calculateQuote(prices.map((price, i) => ({ id: String(i), price })), code, policy, new Date('2026-10-12T00:00:00Z'));
describe('GST-inclusive checkout quote', () => {
  it('allows explicit flat 18 percent event assumptions only in test calculation contexts',()=>{
    const simulated={...policy,classification:'ADMISSION_18',verified:false,feeVerified:false,feeWaiverStartsAt:'2026-10-13T00:00:00Z',simulation:{kind:'DEVELOPMENT_TEST',bracketRule:'FLAT_ADMISSION_18',discountFunding:'SUPPLIER',feeClassification:'998554'}} as const;
    const now=new Date('2026-10-14T00:00:00Z');
    const q=calculateQuote([{id:'a',price:50000},{id:'b',price:10000}],'FIRST50',simulated,now,'razorpay-test',now);
    expect(q.totalPaise).toBe(30000);expect(q.admissionTaxPaise).toBe(4577);expect(q.discountPaise).toBe(30000);expect(q.feePaise).toBe(0);expect(q.simulated).toBe(true);
    expect(q.tickets.map(t=>t.rateBps)).toEqual([1800,1800]);expect(()=>calculateQuote([{id:'a',price:50000}],null,simulated,now,'verified',now)).toThrow();
  });
  it('waives the platform fee and its tax only for bookings created after activation',()=>{
    const p={...policy,verified:false,feeVerified:false,feeWaiverStartsAt:'2026-10-13T12:00:00Z',simulation:{kind:'DEVELOPMENT_TEST',bracketRule:'ORIGINAL_INCLUSIVE_TICKET',discountFunding:'SUPPLIER',feeClassification:'998554'}} as const;
    const now=new Date('2026-10-13T13:00:00Z');
    const fresh=calculateQuote([{id:'a',price:25000}],null,p,now,'development-preview',now);
    expect(fresh.feeWaived).toBe(true);expect(fresh.feeOriginalPaise).toBe(700);expect(fresh.feePaise).toBe(0);expect(fresh.feeTaxPaise).toBe(0);expect(fresh.feeTaxes).toEqual([]);expect(fresh.totalPaise).toBe(25000);
    const old=calculateQuote([{id:'a',price:25000}],null,p,now,'development-preview',new Date('2026-10-13T11:59:59Z'));
    expect(old.feeWaived).toBe(false);expect(old.totalPaise).toBe(25826);
  });
  it('labels a simulation and keeps the original per-ticket bracket after a coupon', () => {
    const simulated = {...policy, verified:false, feeVerified:false,
      simulation:{kind:'DEVELOPMENT_TEST',bracketRule:'ORIGINAL_INCLUSIVE_TICKET',discountFunding:'SUPPLIER',feeClassification:'998554'}} as const;
    const q = calculateQuote([{id:'a',price:20000},{id:'b',price:10000}], 'FIRST50', simulated, new Date('2026-10-13'), 'development-preview');
    expect(q.simulated).toBe(true); expect(q.paymentAllowed).toBe(false);
    expect(q.tickets.map(t=>t.rateBps)).toEqual([1800,500]);
    expect(q.discountPaise).toBe(15000); expect(q.admissionTaxPaise).toBe(1763);
    expect(q.totalPaise).toBe(15826); expect(q.label).toContain('Simulated');
  });
  it('does not allow a test policy to masquerade as verified or run in the default context', () => {
    const simulated = {...policy,simulation:{kind:'DEVELOPMENT_TEST',bracketRule:'ORIGINAL_INCLUSIVE_TICKET',discountFunding:'SUPPLIER',feeClassification:'998554'}} as const;
    expect(()=>calculateQuote([{id:'a',price:20000}],null,simulated,new Date('2026-10-13'))).toThrow();
    expect(()=>calculateQuote([{id:'a',price:20000}],null,simulated,new Date('2026-10-13'),'development-preview')).toThrow();
  });
  it('extracts admission GST once and adds only fee tax', () => {
    const q = quote([20000, 20000], 'FIRST50');
    expect(q.discountPaise).toBe(20000); expect(q.discountedPaise).toBe(20000);
    expect(q.feePaise).toBe(700); expect(q.feeTaxPaise).toBe(126); expect(q.totalPaise).toBe(20826);
    expect(q.ticketBasePaise + q.admissionTaxPaise).toBe(q.discountedPaise);
  });
  it('caps SAVE10 at 100 rupees and does not discount fees', () => {
    expect(quote([200000], 'SAVE10').discountPaise).toBe(10000);
    expect(quote([40000], 'SAVE10').totalPaise).toBe(36826);
  });
  it('allocates odd paise without loss', () => {
    const q = quote([101, 102, 103], 'FIRST50');
    expect(q.discountPaise).toBe(153);
    expect(q.tickets.reduce((n, t) => n + t.discountPaise, 0)).toBe(153);
    expect(q.tickets.reduce((n, t) => n + t.basePaise + t.taxPaise, 0)).toBe(153);
  });
  it('uses discounted per-ticket brackets and reconciles split tax', () => {
    const q = quote([20000, 20200], 'FIRST50');
    expect(q.tickets.map(t => t.rateBps)).toEqual([500, 1800]);
    expect(q.taxes.reduce((n,t)=>n+t.amountPaise,0)).toBe(q.admissionTaxPaise);
  });
  it('supports explicitly verified exemption and interstate configuration', () => {
    const q = calculateQuote([{id:'1',price:40000}], null, {...policy, classification:'EXEMPT', supplyState:'27', feeSupplyState:'27'}, new Date('2026-10-12'));
    expect(q.admissionTaxPaise).toBe(0); expect(q.feeTaxes[0]?.name).toBe('IGST');
  });
  it('applies separately verified sporting brackets and special admission classification',()=>{
    const now=new Date('2026-10-12');
    const sport=calculateQuote([{id:'a',price:50000},{id:'b',price:50100}],null,{...policy,classification:'RECOGNISED_SPORT'},now);
    expect(sport.tickets.map(t=>t.rateBps)).toEqual([0,1800]);
    expect(calculateQuote([{id:'a',price:40000}],null,{...policy,classification:'IPL_LIKE'},now).tickets[0]!.rateBps).toBe(4000);
    expect(calculateQuote([{id:'a',price:40000}],null,{...policy,classification:'ADMISSION_18'},now).tickets[0]!.rateBps).toBe(1800);
  });
  it('requires separate fee verification and rejects unsafe final paise',()=>{
    expect(()=>calculateQuote([{id:'a',price:40000}],null,{...policy,feeVerified:false},new Date('2026-10-12'))).toThrow();
    expect(()=>quote([Number.MAX_SAFE_INTEGER])).toThrow();
  });
  it('rejects unknown, stacked and unverified inputs', () => {
    expect(()=>quote([40000], 'OTHER')).toThrow(); expect(()=>quote([40000], 'FIRST50,SAVE10')).toThrow();
    expect(()=>calculateQuote([{id:'1',price:40000}], null, {...policy,verified:false}, new Date('2026-10-12'))).toThrow();
    expect(()=>calculateQuote([{id:'1',price:40000}], null, policy, new Date('2025-09-21'))).toThrow();
  });
});
