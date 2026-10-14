-- Dedicated event allocations share durable Booking/Payment identity. Every
-- original movie trigger body remains intact and executes for movie bookings.
CREATE TYPE "BookingKind" AS ENUM ('MOVIE','EVENT');
ALTER TABLE bookings ADD COLUMN booking_kind "BookingKind" NOT NULL DEFAULT 'MOVIE';
ALTER TABLE bookings ALTER COLUMN show_id DROP NOT NULL;
ALTER TABLE bookings ADD COLUMN event_session_id UUID REFERENCES event_sessions(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE bookings ADD CONSTRAINT bookings_target_xor CHECK(
  (booking_kind='MOVIE' AND show_id IS NOT NULL AND event_session_id IS NULL) OR
  (booking_kind='EVENT' AND show_id IS NULL AND event_session_id IS NOT NULL));
ALTER TABLE bookings ADD CONSTRAINT bookings_id_event_session_id_key UNIQUE(id,event_session_id);
CREATE INDEX bookings_event_session_id_idx ON bookings(event_session_id);

CREATE TABLE event_booking_seats (
  id UUID PRIMARY KEY, booking_id UUID NOT NULL, event_session_id UUID NOT NULL,
  event_seat_id UUID NOT NULL REFERENCES event_seats(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  price INTEGER NOT NULL CHECK(price>0),
  CONSTRAINT event_booking_seats_booking_id_event_session_id_fkey FOREIGN KEY(booking_id,event_session_id)
    REFERENCES bookings(id,event_session_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT event_booking_seats_event_session_id_fkey FOREIGN KEY(event_session_id)
    REFERENCES event_sessions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT event_booking_seats_id_event_session_id_event_seat_id_key UNIQUE(id,event_session_id,event_seat_id),
  CONSTRAINT event_booking_seats_booking_id_event_seat_id_key UNIQUE(booking_id,event_seat_id)
);
CREATE INDEX event_booking_seats_event_seat_id_idx ON event_booking_seats(event_seat_id);
CREATE TABLE event_confirmed_seats (
  session_id UUID NOT NULL, seat_id UUID NOT NULL, booking_seat_id UUID NOT NULL UNIQUE,
  PRIMARY KEY(session_id,seat_id),
  CONSTRAINT event_confirmed_seats_booking_seat_id_session_id_seat_id_key UNIQUE(booking_seat_id,session_id,seat_id),
  CONSTRAINT event_confirmed_seats_booking_seat_id_session_id_seat_id_fkey
    FOREIGN KEY(booking_seat_id,session_id,seat_id) REFERENCES event_booking_seats(id,event_session_id,event_seat_id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

DROP TRIGGER bookings_write_guard ON bookings;
CREATE TRIGGER bookings_write_guard BEFORE UPDATE ON bookings FOR EACH ROW
  WHEN (NEW.booking_kind='MOVIE') EXECUTE FUNCTION guard_booking_write();
CREATE TRIGGER bookings_movie_insert_guard BEFORE INSERT ON bookings FOR EACH ROW
  WHEN (NEW.booking_kind='MOVIE') EXECUTE FUNCTION guard_booking_write();
CREATE TRIGGER bookings_movie_delete_guard BEFORE DELETE ON bookings FOR EACH ROW
  WHEN (OLD.booking_kind='MOVIE') EXECUTE FUNCTION guard_booking_write();
DROP TRIGGER bookings_allocate_status ON bookings;
CREATE TRIGGER bookings_allocate_status AFTER UPDATE OF status ON bookings FOR EACH ROW
  WHEN (NEW.booking_kind='MOVIE') EXECUTE FUNCTION allocate_booking_status();
DROP TRIGGER bookings_integrity ON bookings;
CREATE CONSTRAINT TRIGGER bookings_integrity AFTER INSERT OR UPDATE ON bookings DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.booking_kind='MOVIE') EXECUTE FUNCTION check_booking_integrity();
CREATE CONSTRAINT TRIGGER bookings_movie_delete_integrity AFTER DELETE ON bookings DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (OLD.booking_kind='MOVIE') EXECUTE FUNCTION check_booking_integrity();
DROP TRIGGER bookings_cancellation_guard ON bookings;
CREATE TRIGGER bookings_cancellation_guard BEFORE UPDATE OF status ON bookings FOR EACH ROW
  WHEN (NEW.booking_kind='MOVIE') EXECUTE FUNCTION guard_booking_cancellation();
DROP TRIGGER bookings_cancellation_integrity ON bookings;
CREATE CONSTRAINT TRIGGER bookings_cancellation_integrity AFTER UPDATE OF status ON bookings DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.booking_kind='MOVIE') EXECUTE FUNCTION check_booking_cancellation();

CREATE FUNCTION guard_booking_target() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM require_read_committed();
  IF NEW.booking_kind IS DISTINCT FROM OLD.booking_kind OR NEW.event_session_id IS DISTINCT FROM OLD.event_session_id THEN
    RAISE EXCEPTION 'Booking target is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bookings_target_guard BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION guard_booking_target();

CREATE FUNCTION guard_event_booking_write() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE start_value TIMESTAMPTZ; session_state "EventSessionStatus"; event_value UUID; active_value BOOLEAN;
BEGIN
  PERFORM require_read_committed();
  IF TG_OP='DELETE' THEN
    IF OLD.status='CONFIRMED' THEN RAISE EXCEPTION 'Confirmed booking requires cancellation before deletion' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'PENDING' OR NEW.confirmed_at IS NOT NULL THEN RAISE EXCEPTION 'Booking must begin pending' USING ERRCODE='23514'; END IF;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.show_id IS DISTINCT FROM OLD.show_id
      OR NEW.total_paise IS DISTINCT FROM OLD.total_paise OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
      RAISE EXCEPTION 'Booking quote is immutable' USING ERRCODE='23514';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT(
      (OLD.status='PENDING' AND NEW.status IN ('CONFIRMED','FAILED','CANCELLED')) OR (OLD.status='CONFIRMED' AND NEW.status='CANCELLED')) THEN
      RAISE EXCEPTION 'Invalid booking state transition' USING ERRCODE='23514';
    END IF;
    IF NEW.status='CONFIRMED' AND OLD.status='PENDING' THEN NEW.confirmed_at:=clock_timestamp();
    ELSIF NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN RAISE EXCEPTION 'Confirmation timestamp is immutable' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_OP='INSERT' OR (NEW.status='CONFIRMED' AND OLD.status='PENDING') OR (NEW.status='CANCELLED' AND OLD.status='CONFIRMED') THEN
    SELECT starts_at,status,event_id INTO start_value,session_state,event_value FROM event_sessions WHERE id=NEW.event_session_id FOR SHARE;
    SELECT is_active INTO active_value FROM events WHERE id=event_value FOR SHARE;
    IF TG_OP='UPDATE' AND NEW.status='CANCELLED' THEN
      IF start_value<=clock_timestamp() THEN RAISE EXCEPTION 'Customer cancellation must precede event start' USING ERRCODE='23514'; END IF;
    ELSE
      IF start_value<=clock_timestamp() OR session_state IS DISTINCT FROM 'SCHEDULED'::"EventSessionStatus" OR active_value IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Event is not bookable' USING ERRCODE='23514';
      END IF;
      IF NEW.status='CONFIRMED' AND NEW.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Booking hold expired' USING ERRCODE='23514'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bookings_event_insert_guard BEFORE INSERT ON bookings FOR EACH ROW WHEN (NEW.booking_kind='EVENT') EXECUTE FUNCTION guard_event_booking_write();
CREATE TRIGGER bookings_event_update_guard BEFORE UPDATE ON bookings FOR EACH ROW WHEN (NEW.booking_kind='EVENT') EXECUTE FUNCTION guard_event_booking_write();
CREATE TRIGGER bookings_event_delete_guard BEFORE DELETE ON bookings FOR EACH ROW WHEN (OLD.booking_kind='EVENT') EXECUTE FUNCTION guard_event_booking_write();

CREATE FUNCTION guard_event_booking_seat_write() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE parent_status "BookingStatus"; parent_session UUID; parent_kind "BookingKind";
  session_venue UUID; physical_section UUID; physical_venue UUID; physical_tier "EventTicketTier"; expected_price INTEGER;
BEGIN
  PERFORM require_read_committed();
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Booking seats are immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN
    IF EXISTS(SELECT 1 FROM bookings WHERE id=OLD.booking_id) THEN RAISE EXCEPTION 'Booking seats are immutable' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  SELECT status,event_session_id,booking_kind INTO parent_status,parent_session,parent_kind FROM bookings WHERE id=NEW.booking_id FOR UPDATE;
  IF parent_status IS DISTINCT FROM 'PENDING'::"BookingStatus" OR parent_kind IS DISTINCT FROM 'EVENT'::"BookingKind" OR parent_session IS DISTINCT FROM NEW.event_session_id THEN
    RAISE EXCEPTION 'Event seat booking target mismatch' USING ERRCODE='23514';
  END IF;
  SELECT venue_id INTO session_venue FROM event_sessions WHERE id=NEW.event_session_id FOR SHARE;
  SELECT section_id INTO physical_section FROM event_seats WHERE id=NEW.event_seat_id;
  SELECT venue_id INTO physical_venue FROM event_sections WHERE id=physical_section FOR SHARE;
  SELECT ticket_tier INTO physical_tier FROM event_seats WHERE id=NEW.event_seat_id FOR UPDATE;
  IF session_venue IS NULL OR session_venue IS DISTINCT FROM physical_venue THEN RAISE EXCEPTION 'Seat does not belong to session venue' USING ERRCODE='23514'; END IF;
  SELECT price_paise INTO expected_price FROM event_session_prices WHERE session_id=NEW.event_session_id AND ticket_tier=physical_tier;
  IF NEW.price IS DISTINCT FROM expected_price THEN RAISE EXCEPTION 'Booking price must match server quote' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER event_booking_seats_write_guard BEFORE INSERT OR UPDATE OR DELETE ON event_booking_seats FOR EACH ROW EXECUTE FUNCTION guard_event_booking_seat_write();

CREATE FUNCTION guard_event_confirmed_seat_write() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE parent_id UUID; parent_status "BookingStatus";
BEGIN
  PERFORM require_read_committed();
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Confirmed allocations are immutable' USING ERRCODE='23514'; END IF;
  SELECT booking_id INTO parent_id FROM event_booking_seats WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.booking_seat_id ELSE NEW.booking_seat_id END;
  SELECT status INTO parent_status FROM bookings WHERE id=parent_id FOR UPDATE;
  IF TG_OP='INSERT' AND parent_status IS DISTINCT FROM 'CONFIRMED'::"BookingStatus" THEN RAISE EXCEPTION 'Only confirmed bookings allocate seats' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' AND parent_status='CONFIRMED' THEN RAISE EXCEPTION 'Confirmed allocations require cancellation' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER event_confirmed_seats_write_guard BEFORE INSERT OR UPDATE OR DELETE ON event_confirmed_seats FOR EACH ROW EXECUTE FUNCTION guard_event_confirmed_seat_write();

CREATE FUNCTION allocate_event_booking_status() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='CONFIRMED' AND OLD.status='PENDING' THEN
    INSERT INTO event_confirmed_seats(session_id,seat_id,booking_seat_id)
      SELECT event_session_id,event_seat_id,id FROM event_booking_seats WHERE booking_id=NEW.id ORDER BY event_seat_id;
  ELSIF NEW.status='CANCELLED' AND OLD.status='CONFIRMED' THEN
    DELETE FROM event_confirmed_seats WHERE booking_seat_id IN(SELECT id FROM event_booking_seats WHERE booking_id=NEW.id);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER bookings_event_allocate_status AFTER UPDATE OF status ON bookings FOR EACH ROW WHEN (NEW.booking_kind='EVENT') EXECUTE FUNCTION allocate_event_booking_status();

CREATE FUNCTION check_event_booking_integrity() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE target UUID; state_value "BookingStatus"; total_value BIGINT; actual_total BIGINT; seat_count BIGINT; allocation_count BIGINT;
  expiry TIMESTAMPTZ; session UUID; starts TIMESTAMPTZ; session_state "EventSessionStatus"; event_id UUID; active BOOLEAN;
  target_payment UUID; payment_state "PaymentStatus";
BEGIN
  IF TG_TABLE_NAME='bookings' THEN target:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
  ELSIF TG_TABLE_NAME='event_booking_seats' THEN target:=CASE WHEN TG_OP='DELETE' THEN OLD.booking_id ELSE NEW.booking_id END;
  ELSE SELECT booking_id INTO target FROM event_booking_seats WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.booking_seat_id ELSE NEW.booking_seat_id END; END IF;
  SELECT status,total_paise,expires_at,event_session_id INTO state_value,total_value,expiry,session FROM bookings WHERE id=target FOR UPDATE;
  IF state_value IS NULL THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME='bookings' AND TG_OP='UPDATE' THEN
    IF (OLD.status='PENDING' AND NEW.status='CONFIRMED' AND state_value='CONFIRMED') OR (OLD.status='CONFIRMED' AND NEW.status='CANCELLED') THEN
      SELECT starts_at,status,event_sessions.event_id INTO starts,session_state,event_id FROM event_sessions WHERE id=session FOR SHARE;
      IF starts<=clock_timestamp() THEN RAISE EXCEPTION 'Event booking transition must precede start at commit' USING ERRCODE='23514'; END IF;
      IF NEW.status='CONFIRMED' THEN
        SELECT is_active INTO active FROM events WHERE id=event_id FOR SHARE;
        IF expiry<=clock_timestamp() OR session_state<>'SCHEDULED' OR active IS DISTINCT FROM true THEN RAISE EXCEPTION 'Event hold/session invalid at commit' USING ERRCODE='23514'; END IF;
      ELSE
        SELECT id,status INTO target_payment,payment_state FROM payments WHERE booking_id=target FOR UPDATE;
        IF EXISTS(SELECT 1 FROM payment_evidence WHERE payment_id=target_payment AND captured) THEN
          IF payment_state NOT IN ('REFUND_PENDING','REFUNDED') OR EXISTS(
            SELECT 1 FROM payment_evidence e WHERE e.payment_id=target_payment AND e.captured AND NOT EXISTS(
              SELECT 1 FROM refunds r WHERE r.payment_id=target_payment AND r.provider_payment_id=e.provider_payment_id AND r.amount_paise=e.amount_paise AND r.currency=e.currency)) THEN
            RAISE EXCEPTION 'Paid cancellation requires atomic full captured-source refund obligations' USING ERRCODE='23514';
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;
  SELECT count(*),COALESCE(sum(price),0) INTO seat_count,actual_total FROM event_booking_seats WHERE booking_id=target;
  IF seat_count=0 OR seat_count>10 OR actual_total<>total_value THEN RAISE EXCEPTION 'Booking total must match nonempty bounded seat quote' USING ERRCODE='23514'; END IF;
  SELECT count(*) INTO allocation_count FROM event_confirmed_seats a JOIN event_booking_seats s ON s.id=a.booking_seat_id WHERE s.booking_id=target;
  IF (state_value='CONFIRMED' AND allocation_count<>seat_count) OR (state_value<>'CONFIRMED' AND allocation_count<>0) THEN RAISE EXCEPTION 'Booking allocations must match confirmation state' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER bookings_event_integrity AFTER INSERT OR UPDATE ON bookings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.booking_kind='EVENT') EXECUTE FUNCTION check_event_booking_integrity();
CREATE CONSTRAINT TRIGGER bookings_event_delete_integrity AFTER DELETE ON bookings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (OLD.booking_kind='EVENT') EXECUTE FUNCTION check_event_booking_integrity();
CREATE CONSTRAINT TRIGGER event_booking_seats_integrity AFTER INSERT OR UPDATE OR DELETE ON event_booking_seats DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_event_booking_integrity();
CREATE CONSTRAINT TRIGGER event_confirmed_seats_integrity AFTER INSERT OR UPDATE OR DELETE ON event_confirmed_seats DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_event_booking_integrity();
