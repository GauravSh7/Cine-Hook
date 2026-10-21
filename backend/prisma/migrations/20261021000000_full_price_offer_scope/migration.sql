-- Only FIRST50 redemption needs the first-offer reservation. Full-price/SAVE10
-- orders must proceed without moving/releasing another uncertain reservation.
-- Keep historical quotes, payment evidence, ownership locks and constraints.
CREATE OR REPLACE FUNCTION guard_payment_offer() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE b bookings; offer first_booking_offers; coupon VARCHAR(20);
BEGIN
 PERFORM require_read_committed();
 SELECT * INTO b FROM bookings WHERE id=NEW.booking_id FOR UPDATE;
 PERFORM 1 FROM users WHERE id=b.user_id FOR UPDATE;
 SELECT coupon_code INTO coupon FROM booking_pricing_quotes WHERE booking_id=b.id AND frozen_at IS NOT NULL;
 IF coupon='FIRST50' THEN
   SELECT * INTO offer FROM first_booking_offers WHERE user_id=b.user_id;
   IF offer.reserved_booking_id IS DISTINCT FROM b.id OR offer.consumed_at IS NOT NULL
     OR EXISTS(SELECT 1 FROM payments p JOIN bookings x ON x.id=p.booking_id WHERE x.user_id=b.user_id AND x.id<>b.id) THEN
     RAISE EXCEPTION 'First offer cannot follow another issued payment order' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END $$;
