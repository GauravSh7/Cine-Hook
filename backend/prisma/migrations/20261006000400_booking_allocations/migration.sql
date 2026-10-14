CREATE TYPE "BookingStatus" AS ENUM ('PENDING','CONFIRMED','FAILED','CANCELLED');
CREATE TABLE bookings (
  id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  show_id UUID NOT NULL REFERENCES shows(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  status "BookingStatus" NOT NULL DEFAULT 'PENDING',
  total_paise BIGINT NOT NULL CHECK(total_paise>0 AND total_paise<=2147483647000),
  expires_at TIMESTAMPTZ(3) NOT NULL, confirmed_at TIMESTAMPTZ(3), failure_code VARCHAR(100),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL,
  CONSTRAINT bookings_id_show_id_key UNIQUE(id,show_id)
);
CREATE INDEX bookings_user_id_created_at_id_idx ON bookings(user_id,created_at,id);
CREATE INDEX bookings_status_expires_at_idx ON bookings(status,expires_at);
CREATE INDEX bookings_show_id_idx ON bookings(show_id);
CREATE TABLE booking_seats (
  id UUID PRIMARY KEY, booking_id UUID NOT NULL, show_id UUID NOT NULL,
  seat_id UUID NOT NULL REFERENCES seats(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  price INTEGER NOT NULL CHECK(price>0),
  CONSTRAINT booking_seats_booking_id_show_id_fkey FOREIGN KEY(booking_id,show_id) REFERENCES bookings(id,show_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT booking_seats_id_show_id_seat_id_key UNIQUE(id,show_id,seat_id),
  CONSTRAINT booking_seats_booking_id_seat_id_key UNIQUE(booking_id,seat_id)
);
CREATE INDEX booking_seats_seat_id_idx ON booking_seats(seat_id);
CREATE TABLE confirmed_seats (
  show_id UUID NOT NULL, seat_id UUID NOT NULL, booking_seat_id UUID NOT NULL UNIQUE,
  PRIMARY KEY(show_id,seat_id),
  CONSTRAINT confirmed_seats_booking_seat_id_show_id_seat_id_key UNIQUE(booking_seat_id,show_id,seat_id),
  CONSTRAINT confirmed_seats_booking_seat_id_show_id_seat_id_fkey FOREIGN KEY(booking_seat_id,show_id,seat_id)
    REFERENCES booking_seats(id,show_id,seat_id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE FUNCTION guard_booking_write() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE start_value TIMESTAMPTZ; show_status "ShowStatus"; movie_value UUID; active_value BOOLEAN;
BEGIN
  PERFORM require_read_committed();
  IF TG_OP='DELETE' THEN
    IF OLD.status='CONFIRMED' THEN RAISE EXCEPTION 'Confirmed booking requires cancellation before deletion' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'PENDING' OR NEW.confirmed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Booking must begin pending' USING ERRCODE='23514';
    END IF;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.show_id IS DISTINCT FROM OLD.show_id
      OR NEW.total_paise IS DISTINCT FROM OLD.total_paise OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
      RAISE EXCEPTION 'Booking quote is immutable' USING ERRCODE='23514';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT(
      (OLD.status='PENDING' AND NEW.status IN ('CONFIRMED','FAILED','CANCELLED')) OR
      (OLD.status='CONFIRMED' AND NEW.status='CANCELLED')
    ) THEN RAISE EXCEPTION 'Invalid booking state transition' USING ERRCODE='23514'; END IF;
    IF NEW.status='CONFIRMED' AND OLD.status='PENDING' THEN NEW.confirmed_at:=clock_timestamp();
    ELSIF NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
      RAISE EXCEPTION 'Confirmation timestamp is immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='INSERT' OR (NEW.status='CONFIRMED' AND OLD.status='PENDING') THEN
    SELECT starts_at,status,movie_id INTO start_value,show_status,movie_value FROM shows WHERE id=NEW.show_id FOR SHARE;
    SELECT is_active INTO active_value FROM movies WHERE id=movie_value FOR SHARE;
    IF start_value<=clock_timestamp() OR show_status<>'SCHEDULED' OR active_value IS FALSE THEN
      RAISE EXCEPTION 'Show is not bookable' USING ERRCODE='23514';
    END IF;
    IF NEW.status='CONFIRMED' AND NEW.expires_at<=clock_timestamp() THEN
      RAISE EXCEPTION 'Booking hold expired' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bookings_write_guard BEFORE INSERT OR UPDATE OR DELETE ON bookings FOR EACH ROW EXECUTE FUNCTION guard_booking_write();

CREATE FUNCTION guard_booking_seat_write() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE parent_status "BookingStatus"; parent_show UUID; show_screen UUID; physical_screen UUID; physical_type "SeatType"; expected_price INTEGER;
BEGIN
  PERFORM require_read_committed();
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Booking seats are immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN
    IF EXISTS(SELECT 1 FROM bookings WHERE id=OLD.booking_id) THEN
      RAISE EXCEPTION 'Booking seats are immutable' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  SELECT status,show_id INTO parent_status,parent_show FROM bookings WHERE id=NEW.booking_id FOR UPDATE;
  IF parent_status IS NOT NULL AND parent_status<>'PENDING' THEN RAISE EXCEPTION 'Only pending bookings accept seats' USING ERRCODE='23514'; END IF;
  IF parent_show IS NOT NULL AND parent_show<>NEW.show_id THEN RAISE EXCEPTION 'Booking seat show mismatch' USING ERRCODE='23514'; END IF;
  SELECT screen_id INTO show_screen FROM shows WHERE id=NEW.show_id FOR SHARE;
  SELECT screen_id,seat_type INTO physical_screen,physical_type FROM seats WHERE id=NEW.seat_id FOR UPDATE;
  IF show_screen IS DISTINCT FROM physical_screen THEN RAISE EXCEPTION 'Seat does not belong to show screen' USING ERRCODE='23514'; END IF;
  SELECT price_paise INTO expected_price FROM show_seat_prices WHERE show_id=NEW.show_id AND seat_type=physical_type;
  IF NEW.price IS DISTINCT FROM expected_price THEN RAISE EXCEPTION 'Booking price must match server quote' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER booking_seats_write_guard BEFORE INSERT OR UPDATE OR DELETE ON booking_seats FOR EACH ROW EXECUTE FUNCTION guard_booking_seat_write();

CREATE FUNCTION guard_confirmed_seat_write() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE parent_id UUID; parent_status "BookingStatus";
BEGIN
  PERFORM require_read_committed();
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Confirmed allocations are immutable' USING ERRCODE='23514'; END IF;
  SELECT booking_id INTO parent_id FROM booking_seats WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.booking_seat_id ELSE NEW.booking_seat_id END;
  SELECT status INTO parent_status FROM bookings WHERE id=parent_id FOR UPDATE;
  IF TG_OP='INSERT' AND parent_status IS DISTINCT FROM 'CONFIRMED'::"BookingStatus" THEN
    RAISE EXCEPTION 'Only confirmed bookings allocate seats' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' AND parent_status='CONFIRMED' THEN
    RAISE EXCEPTION 'Confirmed allocations require cancellation' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER confirmed_seats_write_guard BEFORE INSERT OR UPDATE OR DELETE ON confirmed_seats FOR EACH ROW EXECUTE FUNCTION guard_confirmed_seat_write();

CREATE FUNCTION allocate_booking_status() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='CONFIRMED' AND OLD.status='PENDING' THEN
    INSERT INTO confirmed_seats(show_id,seat_id,booking_seat_id)
      SELECT show_id,seat_id,id FROM booking_seats WHERE booking_id=NEW.id ORDER BY seat_id;
  ELSIF NEW.status='CANCELLED' AND OLD.status='CONFIRMED' THEN
    DELETE FROM confirmed_seats WHERE booking_seat_id IN (SELECT id FROM booking_seats WHERE booking_id=NEW.id);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER bookings_allocate_status AFTER UPDATE OF status ON bookings FOR EACH ROW EXECUTE FUNCTION allocate_booking_status();

CREATE FUNCTION check_booking_integrity() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE target UUID; state_value "BookingStatus"; total_value BIGINT; actual_total BIGINT; seat_count BIGINT; allocation_count BIGINT; expiry_value TIMESTAMPTZ; target_show UUID; show_starts TIMESTAMPTZ; show_state "ShowStatus"; target_movie UUID; movie_active BOOLEAN;
BEGIN
  IF TG_TABLE_NAME='bookings' THEN target:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
  ELSIF TG_TABLE_NAME='booking_seats' THEN target:=CASE WHEN TG_OP='DELETE' THEN OLD.booking_id ELSE NEW.booking_id END;
  ELSE SELECT booking_id INTO target FROM booking_seats WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.booking_seat_id ELSE NEW.booking_seat_id END;
  END IF;
  SELECT status,total_paise,expires_at,show_id INTO state_value,total_value,expiry_value,target_show FROM bookings WHERE id=target FOR UPDATE;
  IF state_value IS NULL THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME='bookings' THEN
    IF TG_OP='UPDATE' THEN
      IF OLD.status='PENDING' AND NEW.status='CONFIRMED' AND state_value='CONFIRMED' THEN
        IF expiry_value<=clock_timestamp() THEN RAISE EXCEPTION 'Booking hold expired before commit' USING ERRCODE='23514'; END IF;
        SELECT starts_at,status,movie_id INTO show_starts,show_state,target_movie FROM shows WHERE id=target_show FOR SHARE;
        SELECT is_active INTO movie_active FROM movies WHERE id=target_movie FOR SHARE;
        IF show_starts<=clock_timestamp() OR show_state<>'SCHEDULED' OR movie_active IS FALSE THEN
          RAISE EXCEPTION 'Show is not bookable before commit' USING ERRCODE='23514';
        END IF;
      END IF;
    END IF;
  END IF;
  SELECT count(*),COALESCE(sum(price),0) INTO seat_count,actual_total FROM booking_seats WHERE booking_id=target;
  IF seat_count=0 OR actual_total<>total_value THEN RAISE EXCEPTION 'Booking total must match nonempty seat quote' USING ERRCODE='23514'; END IF;
  SELECT count(*) INTO allocation_count FROM confirmed_seats JOIN booking_seats ON booking_seats.id=confirmed_seats.booking_seat_id WHERE booking_seats.booking_id=target;
  IF (state_value='CONFIRMED' AND allocation_count<>seat_count) OR (state_value<>'CONFIRMED' AND allocation_count<>0) THEN
    RAISE EXCEPTION 'Booking allocations must match confirmation state' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER bookings_integrity AFTER INSERT OR UPDATE OR DELETE ON bookings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_booking_integrity();
CREATE CONSTRAINT TRIGGER booking_seats_integrity AFTER INSERT OR UPDATE OR DELETE ON booking_seats DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_booking_integrity();
CREATE CONSTRAINT TRIGGER confirmed_seats_integrity AFTER INSERT OR UPDATE OR DELETE ON confirmed_seats DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_booking_integrity();

CREATE FUNCTION guard_booked_show_identity() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.movie_id IS DISTINCT FROM OLD.movie_id OR NEW.screen_id IS DISTINCT FROM OLD.screen_id
    OR NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at THEN
    IF EXISTS(SELECT 1 FROM bookings WHERE show_id=OLD.id) THEN RAISE EXCEPTION 'Booked show identity is fixed' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER shows_booking_identity_guard BEFORE UPDATE ON shows FOR EACH ROW EXECUTE FUNCTION guard_booked_show_identity();
