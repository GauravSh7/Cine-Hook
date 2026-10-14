import type { TaxPolicy } from './pricing-engine.js';

// Calculation references, not certification of a supplier or GST liability.
// State 29 is deliberately a fictional same-state TEST assumption for both
// supplies, not derived from a browsing city or the user's address.
export const cinemaSimulationPolicy: TaxPolicy = {
  classification:'CINEMA',effectiveFrom:'2025-09-22T00:00:00+05:30',effectiveTo:null,
  verified:false,feeVerified:false,supplierState:'29',supplyState:'29',feeSupplierState:'29',feeSupplyState:'29',
  feeRateBps:1800,
  source:'TEST reference: cinema 5%/18%; original inclusive price determines bracket by simulation rule only. https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/oct/doc2025105657401.pdf',
  feeSource:'TEST assumption only: separate SAC 998554 reservation service at 18%. https://cbic-gst.gov.in/hindi/gst-goods-services-rates.html',
  simulation:{kind:'DEVELOPMENT_TEST',bracketRule:'ORIGINAL_INCLUSIVE_TICKET',discountFunding:'SUPPLIER',feeClassification:'998554'},
};
// Explicitly approved flat admission assumption; never verified legal GST.
export const eventSimulationPolicy:TaxPolicy={...cinemaSimulationPolicy,classification:'ADMISSION_18',
  source:'User-approved TEST assumption only: 18% included admission tax for supported Events, Sports and Activities. Not a legal classification.',
  simulation:{...cinemaSimulationPolicy.simulation!,bracketRule:'FLAT_ADMISSION_18'}};
