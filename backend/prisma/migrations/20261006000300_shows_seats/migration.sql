CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TYPE "SeatType" AS ENUM ('REGULAR', 'PREMIUM', 'RECLINER');
CREATE TYPE "ShowStatus" AS ENUM ('SCHEDULED', 'CANCELLED');
CREATE TABLE seats (
  id UUID PRIMARY KEY, screen_id UUID NOT NULL REFERENCES screens(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  row_name VARCHAR(10) NOT NULL CHECK (row_name ~ '^[A-Z]{1,10}$'),
  seat_number INTEGER NOT NULL CHECK (seat_number > 0), seat_type "SeatType" NOT NULL,
  CONSTRAINT seats_screen_id_row_name_seat_number_key UNIQUE(screen_id,row_name,seat_number)
);
CREATE TABLE shows (
  id UUID PRIMARY KEY, movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  screen_id UUID NOT NULL REFERENCES screens(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  starts_at TIMESTAMPTZ(3) NOT NULL, ends_at TIMESTAMPTZ(3) NOT NULL,
  status "ShowStatus" NOT NULL DEFAULT 'SCHEDULED',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL,
  CONSTRAINT shows_valid_interval CHECK (ends_at > starts_at),
  CONSTRAINT shows_no_overlap EXCLUDE USING gist
    (screen_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE (status = 'SCHEDULED')
);
CREATE INDEX shows_movie_id_starts_at_id_idx ON shows(movie_id,starts_at,id);
CREATE INDEX shows_screen_id_starts_at_id_idx ON shows(screen_id,starts_at,id);
CREATE INDEX shows_starts_at_id_idx ON shows(starts_at,id);
CREATE TABLE show_seat_prices (
  show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE ON UPDATE CASCADE,
  seat_type "SeatType" NOT NULL, price_paise INTEGER NOT NULL CHECK (price_paise > 0),
  PRIMARY KEY(show_id,seat_type)
);

-- Cross-table guards rely on a fresh statement snapshot after acquiring parent
-- locks. Reject stale-snapshot modes for these protected writes explicitly.
CREATE FUNCTION require_read_committed() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Show and layout writes require READ COMMITTED isolation' USING ERRCODE='23514';
  END IF;
END $$;

-- All physical-layout writers serialize on their screen. No layout mutation is
-- permitted while a show exists; zero seats represents an unconfigured screen.
CREATE FUNCTION guard_seat_write() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE target UUID;
BEGIN
  PERFORM require_read_committed();
  IF TG_OP = 'UPDATE' AND NEW.screen_id IS DISTINCT FROM OLD.screen_id THEN
    RAISE EXCEPTION 'Seats cannot move between screens' USING ERRCODE='23514';
  END IF;
  target := CASE WHEN TG_OP = 'DELETE' THEN OLD.screen_id ELSE NEW.screen_id END;
  PERFORM 1 FROM screens WHERE id=target FOR UPDATE;
  IF EXISTS(SELECT 1 FROM shows WHERE screen_id=target) THEN
    RAISE EXCEPTION 'Seat layout is fixed after scheduling' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER seats_write_guard BEFORE INSERT OR UPDATE OR DELETE ON seats
  FOR EACH ROW EXECUTE FUNCTION guard_seat_write();

CREATE FUNCTION check_seat_count() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE target UUID; actual BIGINT; expected INTEGER;
BEGIN
  target := CASE WHEN TG_OP='DELETE' THEN OLD.screen_id ELSE NEW.screen_id END;
  SELECT capacity INTO expected FROM screens WHERE id=target;
  SELECT count(*) INTO actual FROM seats WHERE screen_id=target;
  IF expected IS NOT NULL AND actual<>0 AND actual<>expected THEN
    RAISE EXCEPTION 'Seat layout must match screen capacity' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER seats_complete_layout AFTER INSERT OR UPDATE OR DELETE ON seats
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_seat_count();

CREATE FUNCTION guard_show_write() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE parent UUID; locked_parent UUID; capacity_value INTEGER; duration_value INTEGER; active_value BOOLEAN;
BEGIN
  PERFORM require_read_committed();
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  SELECT theatre_id INTO parent FROM screens WHERE id=NEW.screen_id;
  PERFORM 1 FROM theatres WHERE id=parent FOR SHARE;
  SELECT theatre_id,capacity INTO locked_parent,capacity_value FROM screens WHERE id=NEW.screen_id FOR UPDATE;
  IF locked_parent IS DISTINCT FROM parent THEN
    RAISE EXCEPTION 'Screen parent changed during scheduling' USING ERRCODE='23514';
  END IF;
  SELECT duration_minutes,is_active INTO duration_value,active_value FROM movies WHERE id=NEW.movie_id FOR SHARE;
  IF TG_OP='INSERT' OR NEW.movie_id IS DISTINCT FROM OLD.movie_id OR NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at THEN
    IF active_value IS FALSE THEN
      RAISE EXCEPTION 'Inactive movie cannot be scheduled' USING ERRCODE='23514';
    END IF;
    IF NEW.ends_at <> NEW.starts_at + duration_value * INTERVAL '1 minute' THEN
      RAISE EXCEPTION 'Show end must snapshot movie duration' USING ERRCODE='23514';
    END IF;
  END IF;
  IF capacity_value IS NOT NULL AND (SELECT count(*) FROM seats WHERE screen_id=NEW.screen_id)<>capacity_value THEN
    RAISE EXCEPTION 'Complete seat layout required before scheduling' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER shows_write_guard BEFORE INSERT OR UPDATE OR DELETE ON shows
  FOR EACH ROW EXECUTE FUNCTION guard_show_write();

CREATE FUNCTION guard_screen_show_identity() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE actual BIGINT;
BEGIN
  IF NEW.capacity IS DISTINCT FROM OLD.capacity OR NEW.theatre_id IS DISTINCT FROM OLD.theatre_id THEN
    PERFORM require_read_committed();
    IF EXISTS(SELECT 1 FROM shows WHERE screen_id=OLD.id) THEN
      RAISE EXCEPTION 'Scheduled screen identity and capacity are fixed' USING ERRCODE='23514';
    END IF;
  END IF;
  SELECT count(*) INTO actual FROM seats WHERE screen_id=OLD.id;
  IF actual<>0 AND actual<>NEW.capacity THEN
    RAISE EXCEPTION 'Capacity must match existing layout' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER screens_show_identity_guard BEFORE UPDATE ON screens
  FOR EACH ROW EXECUTE FUNCTION guard_screen_show_identity();

CREATE FUNCTION guard_theatre_show_city() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.city_id IS DISTINCT FROM OLD.city_id THEN
    PERFORM require_read_committed();
    IF EXISTS(
      SELECT 1 FROM shows JOIN screens ON screens.id=shows.screen_id WHERE screens.theatre_id=OLD.id
    ) THEN
      RAISE EXCEPTION 'Scheduled theatre city is fixed' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER theatres_show_city_guard BEFORE UPDATE ON theatres
  FOR EACH ROW EXECUTE FUNCTION guard_theatre_show_city();

-- Price edits serialize on the show before the statement so concurrent deletes
-- cannot each validate against the other's uncommitted price rows.
CREATE FUNCTION guard_price_write() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM require_read_committed();
  IF TG_OP='UPDATE' THEN
    PERFORM 1 FROM shows WHERE id IN (OLD.show_id,NEW.show_id) ORDER BY id FOR UPDATE;
  ELSIF TG_OP='DELETE' THEN
    PERFORM 1 FROM shows WHERE id=OLD.show_id FOR UPDATE;
  ELSE
    PERFORM 1 FROM shows WHERE id=NEW.show_id FOR UPDATE;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER show_seat_prices_write_guard BEFORE INSERT OR UPDATE OR DELETE ON show_seat_prices
  FOR EACH ROW EXECUTE FUNCTION guard_price_write();

CREATE FUNCTION check_show_prices() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE target UUID; target_screen UUID;
BEGIN
  IF TG_TABLE_NAME='shows' THEN
    target := CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    target := CASE WHEN TG_OP='DELETE' THEN OLD.show_id ELSE NEW.show_id END;
  END IF;
  SELECT screen_id INTO target_screen FROM shows WHERE id=target FOR UPDATE;
  IF target_screen IS NOT NULL AND EXISTS(
    (SELECT DISTINCT seat_type FROM seats WHERE screen_id=target_screen
      EXCEPT SELECT seat_type FROM show_seat_prices WHERE show_id=target)
    UNION ALL
    (SELECT seat_type FROM show_seat_prices WHERE show_id=target
      EXCEPT SELECT DISTINCT seat_type FROM seats WHERE screen_id=target_screen)
  ) THEN
    RAISE EXCEPTION 'Every layout seat type requires exactly one price' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='show_seat_prices' THEN
    IF TG_OP='UPDATE' AND OLD.show_id IS DISTINCT FROM NEW.show_id THEN
      IF EXISTS(SELECT 1 FROM shows WHERE id=OLD.show_id) AND EXISTS(
        SELECT DISTINCT seat_type FROM seats WHERE screen_id=(SELECT screen_id FROM shows WHERE id=OLD.show_id)
        EXCEPT SELECT seat_type FROM show_seat_prices WHERE show_id=OLD.show_id
      ) THEN
        RAISE EXCEPTION 'Original show must retain complete prices' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER shows_complete_prices AFTER INSERT OR UPDATE ON shows
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_show_prices();
CREATE CONSTRAINT TRIGGER show_seat_prices_complete AFTER INSERT OR UPDATE OR DELETE ON show_seat_prices
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_show_prices();
