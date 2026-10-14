BEGIN;
-- Replace only the arithmetic constraint. No financial rows are rewritten;
-- frozen-quote/history triggers and existing pricing versions stay unchanged.
ALTER TABLE booking_pricing_quotes DROP CONSTRAINT booking_pricing_quotes_check1;
ALTER TABLE booking_pricing_quotes ADD CONSTRAINT booking_pricing_quotes_check1 CHECK (
 (breakdown->>'subtotalPaise')::bigint=subtotal_paise
 AND (breakdown->>'discountPaise')::bigint=discount_paise
 AND (breakdown->>'totalPaise')::bigint=final_paise
 AND (breakdown->>'discountedPaise')::bigint=subtotal_paise-discount_paise
 AND (breakdown->>'ticketBasePaise')::bigint+(breakdown->>'admissionTaxPaise')::bigint=subtotal_paise-discount_paise
 AND final_paise=subtotal_paise-discount_paise+(breakdown->>'feePaise')::bigint+(breakdown->>'feeTaxPaise')::bigint
 AND CASE WHEN breakdown->'feeWaived'='true'::jsonb THEN COALESCE(
   breakdown->'simulated'='true'::jsonb AND (breakdown->>'feePaise')::bigint=0
   AND (breakdown->>'feeOriginalPaise')::bigint=700 AND (breakdown->>'feeTaxPaise')::bigint=0
   AND breakdown->'policy'->'verified'='false'::jsonb AND breakdown->'policy'->'feeVerified'='false'::jsonb
   AND breakdown->'policy'->'simulation'->>'kind'='DEVELOPMENT_TEST',false)
 ELSE (breakdown->>'feePaise')::bigint=700 END
);
COMMIT;
