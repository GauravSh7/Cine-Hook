CREATE TYPE "PaymentStatus" AS ENUM ('PENDING','SUCCESS','FAILED');
CREATE TABLE payments (
  id UUID PRIMARY KEY, booking_id UUID NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  receipt VARCHAR(40) NOT NULL UNIQUE CHECK(length(btrim(receipt))>0),
  amount_paise BIGINT NOT NULL CHECK(amount_paise>0 AND amount_paise<=2147483647000),
  currency VARCHAR(3) NOT NULL DEFAULT 'INR' CHECK(currency='INR'),
  provider_order_id VARCHAR(100) UNIQUE CHECK(provider_order_id IS NULL OR length(btrim(provider_order_id))>0),
  status "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  provider_payment_id VARCHAR(100) UNIQUE CHECK(provider_payment_id IS NULL OR length(btrim(provider_payment_id))>0),
  captured_at TIMESTAMPTZ(3), booking_finalized_at TIMESTAMPTZ(3), failure_code VARCHAR(100),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX payments_status_booking_finalized_at_idx ON payments(status,booking_finalized_at);
CREATE TABLE payment_evidence (
  provider_payment_id VARCHAR(100) PRIMARY KEY CHECK(length(btrim(provider_payment_id))>0),
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE ON UPDATE CASCADE,
  amount_paise BIGINT NOT NULL CHECK(amount_paise>0 AND amount_paise<=2147483647000),
  currency VARCHAR(3) NOT NULL DEFAULT 'INR' CHECK(currency='INR'), captured BOOLEAN NOT NULL DEFAULT false,
  failure_seen BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX payment_evidence_payment_id_idx ON payment_evidence(payment_id);
CREATE TABLE payment_webhook_events (
  provider_event_id VARCHAR(100) PRIMARY KEY CHECK(length(btrim(provider_event_id))>0),
  digest CHAR(64) NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'), event_type VARCHAR(60) NOT NULL CHECK(length(btrim(event_type))>0),
  payment_id UUID REFERENCES payments(id) ON DELETE CASCADE ON UPDATE CASCADE,
  provider_payment_id VARCHAR(100), processed_at TIMESTAMPTZ(3), created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX payment_webhook_events_payment_id_idx ON payment_webhook_events(payment_id);
CREATE TABLE payment_reconciliations (
  id UUID PRIMARY KEY, payment_id UUID NOT NULL UNIQUE REFERENCES payments(id) ON DELETE CASCADE ON UPDATE CASCADE,
  reason VARCHAR(100) NOT NULL CHECK(length(btrim(reason))>0), compensation_required BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ(3) NOT NULL,
  CHECK((reason='FULFILLMENT_PENDING' AND NOT compensation_required) OR (reason<>'FULFILLMENT_PENDING' AND compensation_required))
);

-- Services acquire Booking then Payment before these writes. Native callers
-- receive the same serialized checks; PostgreSQL resolves any lock inversion
-- from an arbitrary direct writer by aborting that transaction.
CREATE FUNCTION guard_payment_write() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE quote BIGINT;
BEGIN
  PERFORM require_read_committed();
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  SELECT total_paise INTO quote FROM bookings WHERE id=NEW.booking_id FOR UPDATE;
  IF NEW.amount_paise IS DISTINCT FROM quote THEN RAISE EXCEPTION 'Payment amount must match booking quote' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.booking_id IS DISTINCT FROM OLD.booking_id OR NEW.receipt IS DISTINCT FROM OLD.receipt
      OR NEW.amount_paise IS DISTINCT FROM OLD.amount_paise OR NEW.currency IS DISTINCT FROM OLD.currency THEN
      RAISE EXCEPTION 'Payment quote identity is immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.provider_order_id IS NOT NULL AND NEW.provider_order_id IS DISTINCT FROM OLD.provider_order_id THEN
      RAISE EXCEPTION 'Provider order identity is immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.status='SUCCESS' AND NEW.status<>'SUCCESS' THEN RAISE EXCEPTION 'Captured payment cannot downgrade' USING ERRCODE='23514'; END IF;
    IF OLD.status='FAILED' AND NEW.status='PENDING' THEN RAISE EXCEPTION 'Failed payment cannot become pending' USING ERRCODE='23514'; END IF;
    IF (OLD.provider_payment_id IS NOT NULL AND NEW.provider_payment_id IS DISTINCT FROM OLD.provider_payment_id)
      OR (OLD.captured_at IS NOT NULL AND NEW.captured_at IS DISTINCT FROM OLD.captured_at)
      OR (OLD.booking_finalized_at IS NOT NULL AND NEW.booking_finalized_at IS DISTINCT FROM OLD.booking_finalized_at) THEN
      RAISE EXCEPTION 'First capture and fulfillment timestamps are immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payments_write_guard BEFORE INSERT OR UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION guard_payment_write();

CREATE FUNCTION guard_payment_child_write() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE target UUID; book UUID; trusted_amount BIGINT; trusted_currency VARCHAR(3);
BEGIN
  PERFORM require_read_committed();
  target:=CASE WHEN TG_OP='DELETE' THEN OLD.payment_id ELSE NEW.payment_id END;
  SELECT booking_id INTO book FROM payments WHERE id=target;
  PERFORM 1 FROM bookings WHERE id=book FOR UPDATE;
  SELECT amount_paise,currency INTO trusted_amount,trusted_currency FROM payments WHERE id=target FOR UPDATE;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_TABLE_NAME='payment_evidence' THEN
    IF NEW.amount_paise IS DISTINCT FROM trusted_amount OR NEW.currency IS DISTINCT FROM trusted_currency THEN
      RAISE EXCEPTION 'Provider evidence does not match payment quote' USING ERRCODE='23514';
    END IF;
    IF TG_OP='UPDATE' THEN
      IF NEW.provider_payment_id IS DISTINCT FROM OLD.provider_payment_id OR NEW.payment_id IS DISTINCT FROM OLD.payment_id
        OR NEW.amount_paise IS DISTINCT FROM OLD.amount_paise OR NEW.currency IS DISTINCT FROM OLD.currency
        OR (OLD.captured AND NOT NEW.captured) OR (OLD.failure_seen AND NOT NEW.failure_seen) THEN
        RAISE EXCEPTION 'Provider evidence identity and financial truth are immutable' USING ERRCODE='23514';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME='payment_webhook_events' THEN
    IF TG_OP='UPDATE' THEN
      IF NEW.provider_event_id IS DISTINCT FROM OLD.provider_event_id OR NEW.digest IS DISTINCT FROM OLD.digest OR NEW.event_type IS DISTINCT FROM OLD.event_type
        OR (OLD.payment_id IS NOT NULL AND NEW.payment_id IS DISTINCT FROM OLD.payment_id)
        OR (OLD.provider_payment_id IS NOT NULL AND NEW.provider_payment_id IS DISTINCT FROM OLD.provider_payment_id)
        OR (OLD.processed_at IS NOT NULL AND NEW.processed_at IS DISTINCT FROM OLD.processed_at) THEN
        RAISE EXCEPTION 'Webhook identity and processed marker are immutable' USING ERRCODE='23514';
      END IF;
    END IF;
  ELSE
    IF TG_OP='UPDATE' THEN
      IF NEW.id IS DISTINCT FROM OLD.id OR NEW.payment_id IS DISTINCT FROM OLD.payment_id OR (OLD.compensation_required AND NOT NEW.compensation_required) THEN
        RAISE EXCEPTION 'Final compensation condition cannot be reversed' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_evidence_write_guard BEFORE INSERT OR UPDATE OR DELETE ON payment_evidence FOR EACH ROW EXECUTE FUNCTION guard_payment_child_write();
CREATE TRIGGER payment_webhook_events_write_guard BEFORE INSERT OR UPDATE OR DELETE ON payment_webhook_events FOR EACH ROW EXECUTE FUNCTION guard_payment_child_write();
CREATE TRIGGER payment_reconciliations_write_guard BEFORE INSERT OR UPDATE OR DELETE ON payment_reconciliations FOR EACH ROW EXECUTE FUNCTION guard_payment_child_write();

CREATE FUNCTION check_payment_integrity() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE target UUID; state_value "PaymentStatus"; first_capture VARCHAR(100); capture_time TIMESTAMPTZ; finalized TIMESTAMPTZ; book UUID; book_state "BookingStatus"; order_id VARCHAR(100); reason_value VARCHAR(100); compensation BOOLEAN;
BEGIN
  IF TG_TABLE_NAME='bookings' THEN SELECT id INTO target FROM payments WHERE booking_id=NEW.id;
  ELSIF TG_TABLE_NAME='payments' THEN target:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE target:=CASE WHEN TG_OP='DELETE' THEN OLD.payment_id ELSE NEW.payment_id END; END IF;
  SELECT booking_id INTO book FROM payments WHERE id=target;
  PERFORM 1 FROM bookings WHERE id=book FOR UPDATE;
  SELECT status,provider_payment_id,captured_at,booking_finalized_at,provider_order_id INTO state_value,first_capture,capture_time,finalized,order_id FROM payments WHERE id=target FOR UPDATE;
  IF state_value IS NULL THEN RETURN NULL; END IF;
  IF EXISTS(SELECT 1 FROM payment_evidence WHERE payment_id=target AND captured) AND state_value<>'SUCCESS' THEN
    RAISE EXCEPTION 'Verified capture must remain financial success' USING ERRCODE='23514';
  END IF;
  IF state_value='SUCCESS' THEN
    IF first_capture IS NULL OR capture_time IS NULL OR order_id IS NULL OR NOT EXISTS(
      SELECT 1 FROM payment_evidence WHERE payment_id=target AND provider_payment_id=first_capture AND captured
    ) THEN RAISE EXCEPTION 'Success requires matching captured evidence' USING ERRCODE='23514'; END IF;
    SELECT reason,compensation_required INTO reason_value,compensation FROM payment_reconciliations WHERE payment_id=target;
    SELECT status INTO book_state FROM bookings WHERE id=book;
    IF finalized IS NULL THEN
      IF reason_value IS DISTINCT FROM 'FULFILLMENT_PENDING' OR compensation IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'Unfinished capture requires durable reconciliation' USING ERRCODE='23514';
      END IF;
    ELSIF book_state<>'CONFIRMED' AND compensation IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Unfulfilled capture requires compensation condition' USING ERRCODE='23514';
    END IF;
  ELSE
    IF first_capture IS NOT NULL OR capture_time IS NOT NULL OR finalized IS NOT NULL THEN
      RAISE EXCEPTION 'Only captured success may finalize' USING ERRCODE='23514';
    END IF;
    IF state_value='FAILED' AND NOT EXISTS(SELECT 1 FROM payment_evidence WHERE payment_id=target AND failure_seen) THEN
      RAISE EXCEPTION 'Financial failure requires verified failure evidence' USING ERRCODE='23514';
    END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM payment_webhook_events e WHERE e.payment_id=target AND e.provider_payment_id IS NOT NULL AND e.processed_at IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM payment_evidence v WHERE v.payment_id=target AND v.provider_payment_id=e.provider_payment_id
  )) THEN RAISE EXCEPTION 'Processed webhook evidence must match payment' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER payments_integrity AFTER INSERT OR UPDATE OR DELETE ON payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_payment_integrity();
CREATE CONSTRAINT TRIGGER payment_evidence_integrity AFTER INSERT OR UPDATE OR DELETE ON payment_evidence DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_payment_integrity();
CREATE CONSTRAINT TRIGGER payment_webhook_events_integrity AFTER INSERT OR UPDATE OR DELETE ON payment_webhook_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_payment_integrity();
CREATE CONSTRAINT TRIGGER payment_reconciliations_integrity AFTER INSERT OR UPDATE OR DELETE ON payment_reconciliations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_payment_integrity();
CREATE CONSTRAINT TRIGGER bookings_payment_integrity AFTER UPDATE ON bookings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_payment_integrity();
