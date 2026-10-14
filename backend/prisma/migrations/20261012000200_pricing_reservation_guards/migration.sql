-- Additive hardening: frozen first-offer reservations cannot move to another order.
CREATE FUNCTION protect_frozen_offer() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' AND NEW.reserved_booking_id IS DISTINCT FROM OLD.reserved_booking_id
   AND OLD.reserved_booking_id IS NOT NULL AND EXISTS(
     SELECT 1 FROM booking_pricing_quotes WHERE booking_id=OLD.reserved_booking_id AND frozen_at IS NOT NULL
   ) THEN RAISE EXCEPTION 'Frozen offer reservation is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER frozen_offer_guard BEFORE UPDATE ON first_booking_offers FOR EACH ROW EXECUTE FUNCTION protect_frozen_offer();

CREATE FUNCTION guard_payment_offer() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE b bookings; offer first_booking_offers; coupon VARCHAR(20);
BEGIN
 PERFORM require_read_committed();
 SELECT * INTO b FROM bookings WHERE id=NEW.booking_id FOR UPDATE;
 PERFORM 1 FROM users WHERE id=b.user_id FOR UPDATE;
 SELECT * INTO offer FROM first_booking_offers WHERE user_id=b.user_id;
 IF offer.reserved_booking_id IS NOT NULL AND offer.reserved_booking_id<>b.id AND offer.consumed_at IS NULL THEN
   RAISE EXCEPTION 'Another checkout reserves the first booking offer' USING ERRCODE='23514'; END IF;
 SELECT coupon_code INTO coupon FROM booking_pricing_quotes WHERE booking_id=b.id AND frozen_at IS NOT NULL;
 IF coupon='FIRST50' AND (offer.reserved_booking_id IS DISTINCT FROM b.id OR offer.consumed_at IS NOT NULL
   OR EXISTS(SELECT 1 FROM payments p JOIN bookings x ON x.id=p.booking_id WHERE x.user_id=b.user_id AND x.id<>b.id)) THEN
   RAISE EXCEPTION 'First offer cannot follow another issued payment order' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payment_offer_guard BEFORE INSERT ON payments FOR EACH ROW EXECUTE FUNCTION guard_payment_offer();

ALTER TABLE booking_pricing_quotes ADD CONSTRAINT complete_pricing_breakdown CHECK(
 jsonb_typeof(breakdown)='object' AND breakdown ?& ARRAY['version','subtotalPaise','discountPaise','discountedPaise','ticketBasePaise','admissionTaxPaise','feePaise','feeTaxPaise','totalPaise','couponCode','tickets','policy']
 AND (breakdown->>'couponCode') IS NOT DISTINCT FROM coupon_code
 AND jsonb_typeof(breakdown->'tickets')='array'
 AND (breakdown->>'version')::integer=1
);
