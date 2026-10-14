-- Additive financial return states. Capture identity and quote history survive
-- every refund transition. Provider HTTP remains outside database transactions.
ALTER TYPE "PaymentStatus" ADD VALUE 'REFUND_PENDING';
ALTER TYPE "PaymentStatus" ADD VALUE 'REFUNDED';
CREATE TYPE "RefundStatus" AS ENUM ('PENDING','REFUNDED');
CREATE TYPE "RefundAttemptStatus" AS ENUM ('REQUESTED','PENDING','FAILED','PROCESSED');

CREATE TABLE refunds (
  id UUID PRIMARY KEY,
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  provider_payment_id VARCHAR(100) NOT NULL UNIQUE REFERENCES payment_evidence(provider_payment_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  amount_paise BIGINT NOT NULL CHECK(amount_paise>0 AND amount_paise<=2147483647000),
  currency VARCHAR(3) NOT NULL DEFAULT 'INR' CHECK(currency='INR'),
  reason VARCHAR(100) NOT NULL CHECK(length(btrim(reason))>0),
  status "RefundStatus" NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX refunds_payment_id_idx ON refunds(payment_id);
CREATE INDEX refunds_status_created_at_idx ON refunds(status,created_at);
CREATE TABLE refund_attempts (
  id UUID PRIMARY KEY,
  refund_id UUID NOT NULL REFERENCES refunds(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  sequence INTEGER NOT NULL CHECK(sequence>0),
  receipt VARCHAR(40) NOT NULL UNIQUE CHECK(length(btrim(receipt))>0),
  provider_refund_id VARCHAR(100) UNIQUE CHECK(provider_refund_id IS NULL OR length(btrim(provider_refund_id))>0),
  status "RefundAttemptStatus" NOT NULL DEFAULT 'REQUESTED',
  last_error_code VARCHAR(100) CHECK(last_error_code IS NULL OR length(btrim(last_error_code))>0),
  processed_at TIMESTAMPTZ(3),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL,
  UNIQUE(refund_id,sequence),
  CHECK((status='PROCESSED' AND provider_refund_id IS NOT NULL AND processed_at IS NOT NULL)
    OR (status<>'PROCESSED' AND processed_at IS NULL)),
  CHECK(status NOT IN ('PENDING','FAILED') OR provider_refund_id IS NOT NULL)
);
CREATE UNIQUE INDEX refund_attempts_one_processed_idx ON refund_attempts(refund_id) WHERE status='PROCESSED';
ALTER TABLE payment_webhook_events ADD COLUMN provider_refund_id VARCHAR(100)
  CHECK(provider_refund_id IS NULL OR length(btrim(provider_refund_id))>0);
ALTER TABLE payment_reconciliations ADD COLUMN resolved_at TIMESTAMPTZ(3);

CREATE OR REPLACE FUNCTION guard_payment_write() RETURNS TRIGGER LANGUAGE plpgsql AS $$
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

CREATE OR REPLACE FUNCTION guard_payment_child_write() RETURNS TRIGGER LANGUAGE plpgsql AS $$
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
        OR (OLD.provider_refund_id IS NOT NULL AND NEW.provider_refund_id IS DISTINCT FROM OLD.provider_refund_id)
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

-- All native refund writers follow Booking -> Payment -> Refund. The parent
-- locks serialize insertion of retries and checks under READ COMMITTED.
CREATE FUNCTION guard_refund_write() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE target UUID; book UUID; first_capture VARCHAR(100); book_state "BookingStatus"; source_payment UUID; source_amount BIGINT; source_currency VARCHAR(3); source_captured BOOLEAN;
BEGIN
  PERFORM require_read_committed();
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Refund history cannot be deleted' USING ERRCODE='23514'; END IF;
  target:=NEW.payment_id;
  SELECT booking_id INTO book FROM payments WHERE id=target;
  SELECT status INTO book_state FROM bookings WHERE id=book FOR UPDATE;
  SELECT provider_payment_id INTO first_capture FROM payments WHERE id=target FOR UPDATE;
  SELECT payment_id,amount_paise,currency,captured INTO source_payment,source_amount,source_currency,source_captured
    FROM payment_evidence WHERE provider_payment_id=NEW.provider_payment_id;
  IF source_payment IS DISTINCT FROM target OR source_captured IS DISTINCT FROM true
    OR NEW.amount_paise IS DISTINCT FROM source_amount OR NEW.currency IS DISTINCT FROM source_currency THEN
    RAISE EXCEPTION 'Refund must fully match its captured payment source' USING ERRCODE='23514';
  END IF;
  IF book_state NOT IN ('CONFIRMED','FAILED','CANCELLED') OR
    (book_state='CONFIRMED' AND NEW.provider_payment_id=first_capture) THEN
    RAISE EXCEPTION 'Confirmed funding cannot be refunded without cancellation' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.payment_id IS DISTINCT FROM OLD.payment_id
    OR NEW.provider_payment_id IS DISTINCT FROM OLD.provider_payment_id OR NEW.amount_paise IS DISTINCT FROM OLD.amount_paise
    OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR (OLD.status='REFUNDED' AND NEW.status<>'REFUNDED')) THEN
    RAISE EXCEPTION 'Refund identity, quote and completion are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER refunds_write_guard BEFORE INSERT OR UPDATE OR DELETE ON refunds FOR EACH ROW EXECUTE FUNCTION guard_refund_write();

CREATE FUNCTION guard_refund_attempt_write() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE target UUID; book UUID; previous_sequence INTEGER; previous_state "RefundAttemptStatus"; previous_provider VARCHAR(100);
BEGIN
  PERFORM require_read_committed();
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Refund attempt history cannot be deleted' USING ERRCODE='23514'; END IF;
  SELECT payment_id INTO target FROM refunds WHERE id=NEW.refund_id;
  SELECT booking_id INTO book FROM payments WHERE id=target;
  PERFORM 1 FROM bookings WHERE id=book FOR UPDATE;
  PERFORM 1 FROM payments WHERE id=target FOR UPDATE;
  PERFORM 1 FROM refunds WHERE id=NEW.refund_id FOR UPDATE;
  IF TG_OP='INSERT' THEN
    SELECT sequence,status,provider_refund_id INTO previous_sequence,previous_state,previous_provider
      FROM refund_attempts WHERE refund_id=NEW.refund_id ORDER BY sequence DESC LIMIT 1;
    IF EXISTS(SELECT 1 FROM refund_attempts WHERE refund_id=NEW.refund_id AND status='PROCESSED') THEN
      RAISE EXCEPTION 'Processed refund cannot be attempted again' USING ERRCODE='23514';
    END IF;
    IF NEW.sequence<>COALESCE(previous_sequence,0)+1 OR
      (previous_sequence IS NOT NULL AND (previous_state<>'FAILED' OR previous_provider IS NULL)) THEN
      RAISE EXCEPTION 'Refund retry requires the immediately preceding verified failed attempt' USING ERRCODE='23514';
    END IF;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.refund_id IS DISTINCT FROM OLD.refund_id OR NEW.sequence IS DISTINCT FROM OLD.sequence
      OR NEW.receipt IS DISTINCT FROM OLD.receipt OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR (OLD.provider_refund_id IS NOT NULL AND NEW.provider_refund_id IS DISTINCT FROM OLD.provider_refund_id)
      OR (OLD.processed_at IS NOT NULL AND NEW.processed_at IS DISTINCT FROM OLD.processed_at)
      OR (OLD.status='PROCESSED' AND NEW.status<>'PROCESSED')
      OR (OLD.status IN ('PENDING','FAILED') AND NEW.status='REQUESTED')
      OR (OLD.status='FAILED' AND NEW.status='PENDING') THEN
      RAISE EXCEPTION 'Refund attempt identity and terminal progress are immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER refund_attempts_write_guard BEFORE INSERT OR UPDATE OR DELETE ON refund_attempts FOR EACH ROW EXECUTE FUNCTION guard_refund_attempt_write();

CREATE OR REPLACE FUNCTION check_payment_integrity() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE target UUID; state_value "PaymentStatus"; first_capture VARCHAR(100); capture_time TIMESTAMPTZ; finalized TIMESTAMPTZ; book UUID; book_state "BookingStatus"; order_id VARCHAR(100); reason_value VARCHAR(100); compensation BOOLEAN;
BEGIN
  IF TG_TABLE_NAME='bookings' THEN SELECT id INTO target FROM payments WHERE booking_id=NEW.id;
  ELSIF TG_TABLE_NAME='payments' THEN target:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
  ELSIF TG_TABLE_NAME='refund_attempts' THEN SELECT payment_id INTO target FROM refunds WHERE id=NEW.refund_id;
  ELSE target:=CASE WHEN TG_OP='DELETE' THEN OLD.payment_id ELSE NEW.payment_id END; END IF;
  SELECT booking_id INTO book FROM payments WHERE id=target;
  PERFORM 1 FROM bookings WHERE id=book FOR UPDATE;
  SELECT status,provider_payment_id,captured_at,booking_finalized_at,provider_order_id INTO state_value,first_capture,capture_time,finalized,order_id FROM payments WHERE id=target FOR UPDATE;
  IF state_value IS NULL THEN RETURN NULL; END IF;
  IF EXISTS(SELECT 1 FROM payment_evidence WHERE payment_id=target AND captured) AND state_value NOT IN ('SUCCESS','REFUND_PENDING','REFUNDED') THEN
    RAISE EXCEPTION 'Verified capture must preserve financial capture evidence' USING ERRCODE='23514';
  END IF;
  IF state_value IN ('SUCCESS','REFUND_PENDING','REFUNDED') THEN
    IF first_capture IS NULL OR capture_time IS NULL OR order_id IS NULL OR NOT EXISTS(
      SELECT 1 FROM payment_evidence WHERE payment_id=target AND provider_payment_id=first_capture AND captured
    ) THEN RAISE EXCEPTION 'Captured states require matching captured evidence' USING ERRCODE='23514'; END IF;
    SELECT reason,compensation_required INTO reason_value,compensation FROM payment_reconciliations WHERE payment_id=target;
    SELECT status INTO book_state FROM bookings WHERE id=book;
    IF finalized IS NULL THEN
      IF state_value<>'SUCCESS' OR reason_value IS DISTINCT FROM 'FULFILLMENT_PENDING' OR compensation IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'Unfinished capture requires durable reconciliation' USING ERRCODE='23514';
      END IF;
    ELSIF book_state<>'CONFIRMED' AND compensation IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Unfulfilled capture requires compensation condition' USING ERRCODE='23514';
    END IF;
    IF state_value IN ('REFUND_PENDING','REFUNDED') AND book_state NOT IN ('FAILED','CANCELLED') THEN
      RAISE EXCEPTION 'Aggregate refund states require an unfulfilled booking' USING ERRCODE='23514';
    END IF;
    IF state_value='REFUNDED' AND EXISTS(
      SELECT 1 FROM payment_evidence e WHERE e.payment_id=target AND e.captured AND NOT EXISTS(
        SELECT 1 FROM refunds r WHERE r.payment_id=target AND r.provider_payment_id=e.provider_payment_id AND r.status='REFUNDED'
      )
    ) THEN RAISE EXCEPTION 'Refunded payment requires all captured sources returned' USING ERRCODE='23514'; END IF;
  ELSE
    IF first_capture IS NOT NULL OR capture_time IS NOT NULL OR finalized IS NOT NULL THEN
      RAISE EXCEPTION 'Only captured states may finalize' USING ERRCODE='23514';
    END IF;
    IF state_value='FAILED' AND NOT EXISTS(SELECT 1 FROM payment_evidence WHERE payment_id=target AND failure_seen) THEN
      RAISE EXCEPTION 'Financial failure requires verified failure evidence' USING ERRCODE='23514';
    END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM refunds r WHERE r.payment_id=target AND (
    NOT EXISTS(SELECT 1 FROM payment_evidence e WHERE e.provider_payment_id=r.provider_payment_id AND e.payment_id=r.payment_id AND e.captured AND e.amount_paise=r.amount_paise AND e.currency=r.currency)
    OR (r.status='REFUNDED' AND NOT EXISTS(SELECT 1 FROM refund_attempts a WHERE a.refund_id=r.id AND a.status='PROCESSED' AND a.provider_refund_id IS NOT NULL AND a.processed_at IS NOT NULL))
    OR (book_state='CONFIRMED' AND r.provider_payment_id=first_capture)
  )) THEN RAISE EXCEPTION 'Refund completion requires matching captured source and processed provider evidence' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM payment_webhook_events e WHERE e.payment_id=target AND e.provider_payment_id IS NOT NULL AND e.processed_at IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM payment_evidence v WHERE v.payment_id=target AND v.provider_payment_id=e.provider_payment_id
  )) THEN RAISE EXCEPTION 'Processed webhook evidence must match payment' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM payment_webhook_events e WHERE e.payment_id=target AND e.provider_refund_id IS NOT NULL AND e.processed_at IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM refund_attempts a JOIN refunds r ON r.id=a.refund_id WHERE a.provider_refund_id=e.provider_refund_id
      AND r.payment_id=target AND r.provider_payment_id=e.provider_payment_id
  )) THEN RAISE EXCEPTION 'Processed refund webhook must match refund source and attempt' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER refunds_payment_integrity AFTER INSERT OR UPDATE ON refunds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_payment_integrity();
CREATE CONSTRAINT TRIGGER refund_attempts_payment_integrity AFTER INSERT OR UPDATE ON refund_attempts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_payment_integrity();

-- A separate additive trigger retains the fourth migration's quote, allocation,
-- confirmation and terminal-state rules, including idempotent CANCELLED writes.
CREATE FUNCTION guard_booking_cancellation() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE starts TIMESTAMPTZ;
BEGIN
  PERFORM require_read_committed();
  IF OLD.status='CONFIRMED' AND NEW.status='CANCELLED' THEN
    SELECT starts_at INTO starts FROM shows WHERE id=NEW.show_id FOR SHARE;
    IF starts<=clock_timestamp() THEN RAISE EXCEPTION 'Customer cancellation must precede show start' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bookings_cancellation_guard BEFORE UPDATE OF status ON bookings FOR EACH ROW EXECUTE FUNCTION guard_booking_cancellation();

CREATE FUNCTION check_booking_cancellation() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE starts TIMESTAMPTZ; target UUID; payment_state "PaymentStatus";
BEGIN
  IF OLD.status<>'CONFIRMED' OR NEW.status<>'CANCELLED' THEN RETURN NULL; END IF;
  PERFORM 1 FROM bookings WHERE id=NEW.id FOR UPDATE;
  SELECT starts_at INTO starts FROM shows WHERE id=NEW.show_id FOR SHARE;
  IF starts<=clock_timestamp() THEN RAISE EXCEPTION 'Customer cancellation must precede show start at commit' USING ERRCODE='23514'; END IF;
  SELECT id,status INTO target,payment_state FROM payments WHERE booking_id=NEW.id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM payment_evidence WHERE payment_id=target AND captured) THEN
    IF payment_state NOT IN ('REFUND_PENDING','REFUNDED') OR EXISTS(
      SELECT 1 FROM payment_evidence e WHERE e.payment_id=target AND e.captured AND NOT EXISTS(
        SELECT 1 FROM refunds r WHERE r.payment_id=target AND r.provider_payment_id=e.provider_payment_id AND r.amount_paise=e.amount_paise AND r.currency=e.currency
      )
    ) THEN RAISE EXCEPTION 'Paid cancellation requires atomic full captured-source refund obligations' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER bookings_cancellation_integrity AFTER UPDATE OF status ON bookings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_booking_cancellation();
