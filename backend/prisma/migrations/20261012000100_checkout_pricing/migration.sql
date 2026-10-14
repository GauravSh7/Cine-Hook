ALTER TABLE bookings ADD COLUMN pricing_version INTEGER NOT NULL DEFAULT 0 CHECK(pricing_version IN (0,1));
CREATE TABLE booking_pricing_quotes (
 booking_id UUID PRIMARY KEY REFERENCES bookings(id) ON DELETE RESTRICT,
 coupon_code VARCHAR(20) CHECK(coupon_code IN ('FIRST50','SAVE10')),
 subtotal_paise BIGINT NOT NULL CHECK(subtotal_paise>0),
 discount_paise BIGINT NOT NULL CHECK(discount_paise>=0 AND discount_paise<=subtotal_paise),
 final_paise BIGINT NOT NULL CHECK(final_paise>0), breakdown JSONB NOT NULL,
 frozen_at TIMESTAMPTZ(3), created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMPTZ(3) NOT NULL,
 CHECK ((breakdown->>'subtotalPaise')::bigint=subtotal_paise AND (breakdown->>'discountPaise')::bigint=discount_paise
 AND (breakdown->>'totalPaise')::bigint=final_paise AND (breakdown->>'feePaise')::bigint=700
 AND (breakdown->>'discountedPaise')::bigint=subtotal_paise-discount_paise
 AND (breakdown->>'ticketBasePaise')::bigint+(breakdown->>'admissionTaxPaise')::bigint=subtotal_paise-discount_paise
 AND final_paise=subtotal_paise-discount_paise+700+(breakdown->>'feeTaxPaise')::bigint)
);
CREATE TABLE first_booking_offers (
 user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
 reserved_booking_id UUID UNIQUE REFERENCES bookings(id) ON DELETE RESTRICT,
 consumed_at TIMESTAMPTZ(3)
);
CREATE TABLE pricing_tax_policies (key VARCHAR(100) PRIMARY KEY, settings JSONB NOT NULL, verified_by VARCHAR(200) NOT NULL, updated_at TIMESTAMPTZ(3) NOT NULL);

CREATE FUNCTION guard_pricing_version() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.pricing_version IS DISTINCT FROM OLD.pricing_version THEN RAISE EXCEPTION 'Booking pricing version is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER booking_pricing_version BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION guard_pricing_version();

CREATE FUNCTION guard_pricing_quote() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE b bookings; offer first_booking_offers;
BEGIN
 PERFORM require_read_committed();
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Financial quote history cannot be deleted' USING ERRCODE='23514'; END IF;
 SELECT * INTO b FROM bookings WHERE id=NEW.booking_id FOR UPDATE;
 IF b.pricing_version<>1 OR NEW.subtotal_paise<>b.total_paise OR b.status<>'PENDING' OR b.expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION 'Invalid pricing target' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD.frozen_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Frozen quote is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.frozen_at IS NOT NULL AND NEW.coupon_code='FIRST50' AND (TG_OP='INSERT' OR OLD.frozen_at IS NULL) THEN
  PERFORM 1 FROM users WHERE id=b.user_id FOR UPDATE;
  SELECT * INTO offer FROM first_booking_offers WHERE user_id=b.user_id;
  IF offer.reserved_booking_id IS DISTINCT FROM b.id OR offer.consumed_at IS NOT NULL
    OR EXISTS(SELECT 1 FROM payment_evidence e JOIN payments p ON p.id=e.payment_id JOIN bookings x ON x.id=p.booking_id WHERE x.user_id=b.user_id AND e.captured) THEN
   RAISE EXCEPTION 'First offer is unavailable' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pricing_quote_guard BEFORE INSERT OR UPDATE OR DELETE ON booking_pricing_quotes FOR EACH ROW EXECUTE FUNCTION guard_pricing_quote();

CREATE FUNCTION guard_first_offer() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 PERFORM require_read_committed();
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Offer evidence cannot be deleted' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM users WHERE id=NEW.user_id FOR UPDATE;
 IF TG_OP='UPDATE' AND (NEW.user_id IS DISTINCT FROM OLD.user_id OR (OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at)) THEN
  RAISE EXCEPTION 'Captured eligibility is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.reserved_booking_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM bookings WHERE id=NEW.reserved_booking_id AND user_id=NEW.user_id) THEN
  RAISE EXCEPTION 'Offer owner mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER first_offer_guard BEFORE INSERT OR UPDATE OR DELETE ON first_booking_offers FOR EACH ROW EXECUTE FUNCTION guard_first_offer();

CREATE FUNCTION consume_first_offer() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE owner_id UUID;
BEGIN
 IF NEW.captured THEN
  SELECT b.user_id INTO owner_id FROM bookings b JOIN payments p ON p.booking_id=b.id WHERE p.id=NEW.payment_id;
  PERFORM 1 FROM users WHERE id=owner_id FOR UPDATE;
  INSERT INTO first_booking_offers(user_id,consumed_at) VALUES(owner_id,clock_timestamp())
   ON CONFLICT(user_id) DO UPDATE SET consumed_at=COALESCE(first_booking_offers.consumed_at,EXCLUDED.consumed_at);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER capture_consumes_offer AFTER INSERT OR UPDATE ON payment_evidence FOR EACH ROW EXECUTE FUNCTION consume_first_offer();

CREATE OR REPLACE FUNCTION guard_payment_write() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE quote BIGINT;
BEGIN
  PERFORM require_read_committed();
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  SELECT CASE WHEN b.pricing_version=0 THEN b.total_paise ELSE q.final_paise END INTO quote
    FROM bookings b LEFT JOIN booking_pricing_quotes q ON q.booking_id=b.id AND q.frozen_at IS NOT NULL
    WHERE b.id=NEW.booking_id FOR UPDATE OF b;
    IF quote IS NULL THEN RAISE EXCEPTION 'Payment needs frozen quote' USING ERRCODE='23514'; END IF;
  IF NEW.amount_paise IS DISTINCT FROM quote THEN RAISE EXCEPTION 'Payment amount must match booking quote' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.booking_id IS DISTINCT FROM OLD.booking_id OR NEW.receipt IS DISTINCT FROM OLD.receipt
      OR NEW.amount_paise IS DISTINCT FROM OLD.amount_paise OR NEW.currency IS DISTINCT FROM OLD.currency THEN
      RAISE EXCEPTION 'Payment quote identity is immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.provider_order_id IS NOT NULL AND NEW.provider_order_id IS DISTINCT FROM OLD.provider_order_id THEN
      RAISE EXCEPTION 'Provider order identity is immutable' USING ERRCODE='23514';
    END IF;
    IF (OLD.status='SUCCESS' AND NEW.status NOT IN ('SUCCESS','REFUND_PENDING'))
      OR (OLD.status='REFUND_PENDING' AND NEW.status NOT IN ('REFUND_PENDING','REFUNDED'))
      OR (OLD.status='REFUNDED' AND NEW.status NOT IN ('REFUNDED','REFUND_PENDING')) THEN
      RAISE EXCEPTION 'Captured payment cannot reverse financial return progress' USING ERRCODE='23514';
    END IF;
    IF OLD.status='REFUNDED' AND NEW.status='REFUND_PENDING' AND NOT EXISTS(
      SELECT 1 FROM payment_evidence e WHERE e.payment_id=OLD.id AND e.captured
        AND e.provider_payment_id<>OLD.provider_payment_id AND NOT EXISTS(
          SELECT 1 FROM refunds r WHERE r.payment_id=OLD.id AND r.provider_payment_id=e.provider_payment_id AND r.status='REFUNDED'
        )
    ) THEN RAISE EXCEPTION 'Only a distinct unreturned capture can reopen refund progress' USING ERRCODE='23514'; END IF;
    IF OLD.status='FAILED' AND NEW.status='PENDING' THEN RAISE EXCEPTION 'Failed payment cannot become pending' USING ERRCODE='23514'; END IF;
    IF (OLD.provider_payment_id IS NOT NULL AND NEW.provider_payment_id IS DISTINCT FROM OLD.provider_payment_id)
      OR (OLD.captured_at IS NOT NULL AND NEW.captured_at IS DISTINCT FROM OLD.captured_at)
      OR (OLD.booking_finalized_at IS NOT NULL AND NEW.booking_finalized_at IS DISTINCT FROM OLD.booking_finalized_at) THEN
      RAISE EXCEPTION 'First capture and fulfillment timestamps are immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
