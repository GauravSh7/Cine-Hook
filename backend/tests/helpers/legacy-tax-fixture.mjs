// Isolated *_test fixtures only. Keep old ticket-only financial expectations
// while supplying the tax policy now required by the actual checkout routes.
export async function legacyTicketPolicy(prisma,theatreId,kind='movie'){
  const key=`${kind}:${theatreId}:integration-ticket-only`;
  await prisma.pricingTaxPolicy.create({data:{key,verifiedBy:'Disposable integration fixture, never a real issuer',settings:{classification:kind==='movie'?'CINEMA':'ADMISSION_18',effectiveFrom:'2025-09-22T00:00:00+05:30',effectiveTo:null,verified:true,feeVerified:true,supplierState:'29',supplyState:'29',feeSupplierState:'29',feeSupplyState:'29',feeRateBps:0,source:'Isolated fictional tax fixture only',feeSource:'Zero fee tax for legacy payment transport assertions; fixed platform fee remains authoritative'}}});
  return key;
}
