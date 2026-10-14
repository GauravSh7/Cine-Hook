CREATE TYPE "EventKind" AS ENUM ('EVENTS','SPORTS','ACTIVITIES');
CREATE TYPE "EventVenueKind" AS ENUM ('AUDITORIUM','STADIUM','ARENA');
CREATE TYPE "EventTicketTier" AS ENUM ('STANDARD','PREMIUM','VIP');
CREATE TYPE "EventSessionStatus" AS ENUM ('SCHEDULED','CANCELLED');
CREATE TABLE events (
 id UUID PRIMARY KEY, slug VARCHAR(200) NOT NULL UNIQUE CHECK(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 title VARCHAR(200) NOT NULL CHECK(length(trim(title))>0), description TEXT NOT NULL CHECK(length(trim(description))>0),
 kind "EventKind" NOT NULL, sport VARCHAR(50), duration_minutes INTEGER NOT NULL CHECK(duration_minutes BETWEEN 1 AND 1440),
 image_url TEXT, image_attribution TEXT, is_sample BOOLEAN NOT NULL DEFAULT true, is_active BOOLEAN NOT NULL DEFAULT true,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ(3) NOT NULL,
 CHECK(sport IS NULL OR (kind='SPORTS' AND length(trim(sport))>0))
);
CREATE INDEX events_is_active_kind_title_id_idx ON events(is_active,kind,title,id);
CREATE TABLE event_performers (
 event_id UUID NOT NULL REFERENCES events(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 name VARCHAR(100) NOT NULL CHECK(length(trim(name))>0), biography TEXT NOT NULL CHECK(length(trim(biography))>0), PRIMARY KEY(event_id,name)
);
CREATE TABLE event_participants (
 event_id UUID NOT NULL REFERENCES events(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 name VARCHAR(100) NOT NULL CHECK(length(trim(name))>0), PRIMARY KEY(event_id,name)
);
CREATE TABLE event_venues (
 id UUID PRIMARY KEY, city_id UUID NOT NULL REFERENCES cities(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 name CITEXT NOT NULL CHECK(length(trim(name::text))>0), address VARCHAR(500) NOT NULL CHECK(length(trim(address))>0),
 kind "EventVenueKind" NOT NULL, capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 100000),
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT event_venues_city_id_name_key UNIQUE(city_id,name)
);
CREATE TABLE event_sections (
 id UUID PRIMARY KEY, venue_id UUID NOT NULL REFERENCES event_venues(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 code VARCHAR(30) NOT NULL CHECK(code ~ '^[A-Z0-9_-]{1,30}$'), name VARCHAR(100) NOT NULL CHECK(length(trim(name))>0),
 position VARCHAR(10) NOT NULL CHECK(position IN ('FRONT','REAR','NORTH','SOUTH','EAST','WEST')),
 sort_order INTEGER NOT NULL CHECK(sort_order>=0),
 CONSTRAINT event_sections_venue_id_code_key UNIQUE(venue_id,code), CONSTRAINT event_sections_id_venue_id_key UNIQUE(id,venue_id)
);
CREATE INDEX event_sections_venue_id_sort_order_id_idx ON event_sections(venue_id,sort_order,id);
CREATE TABLE event_seats (
 id UUID PRIMARY KEY, section_id UUID NOT NULL REFERENCES event_sections(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 row_name VARCHAR(10) NOT NULL CHECK(row_name ~ '^[A-Z]{1,10}$'), seat_number INTEGER NOT NULL CHECK(seat_number>0), ticket_tier "EventTicketTier" NOT NULL,
 CONSTRAINT event_seats_section_id_row_name_seat_number_key UNIQUE(section_id,row_name,seat_number), CONSTRAINT event_seats_id_section_id_key UNIQUE(id,section_id)
);
CREATE TABLE event_sessions (
 id UUID PRIMARY KEY, event_id UUID NOT NULL REFERENCES events(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 venue_id UUID NOT NULL REFERENCES event_venues(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 starts_at TIMESTAMPTZ(3) NOT NULL, ends_at TIMESTAMPTZ(3) NOT NULL, status "EventSessionStatus" NOT NULL DEFAULT 'SCHEDULED',
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT event_sessions_id_venue_id_key UNIQUE(id,venue_id),
 CHECK(ends_at>starts_at AND starts_at>='0001-01-01'::timestamptz AND ends_at<'10000-01-01'::timestamptz),
 CONSTRAINT event_sessions_no_overlap EXCLUDE USING gist (venue_id WITH =,tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE(status='SCHEDULED')
);
CREATE INDEX event_sessions_event_id_starts_at_id_idx ON event_sessions(event_id,starts_at,id);
CREATE INDEX event_sessions_venue_id_starts_at_id_idx ON event_sessions(venue_id,starts_at,id);
CREATE INDEX event_sessions_status_starts_at_id_idx ON event_sessions(status,starts_at,id);
CREATE TABLE event_session_prices (
 session_id UUID NOT NULL REFERENCES event_sessions(id) ON DELETE CASCADE ON UPDATE CASCADE,
 ticket_tier "EventTicketTier" NOT NULL, price_paise INTEGER NOT NULL CHECK(price_paise>0), PRIMARY KEY(session_id,ticket_tier)
);

-- Shared venue row locks serialize layout, identity and scheduling decisions.
-- Fresh snapshots after waits require READ COMMITTED, as with movie Shows.
CREATE FUNCTION guard_event_layout_write() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE target UUID; parent UUID; locked_parent UUID;
BEGIN
 PERFORM require_read_committed();
 IF TG_TABLE_NAME='event_sections' THEN
  IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.venue_id IS DISTINCT FROM OLD.venue_id) THEN
   RAISE EXCEPTION 'Section identity cannot change' USING ERRCODE='23514';
  END IF;
  target := CASE WHEN TG_OP='DELETE' THEN OLD.venue_id ELSE NEW.venue_id END;
 ELSE
  IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.section_id IS DISTINCT FROM OLD.section_id) THEN
   RAISE EXCEPTION 'Seat identity cannot change' USING ERRCODE='23514';
  END IF;
  parent := CASE WHEN TG_OP='DELETE' THEN OLD.section_id ELSE NEW.section_id END;
  SELECT venue_id INTO target FROM event_sections WHERE id=parent;
 END IF;
 PERFORM 1 FROM event_venues WHERE id=target FOR UPDATE;
 IF TG_TABLE_NAME='event_seats' THEN
  SELECT venue_id INTO locked_parent FROM event_sections WHERE id=parent FOR SHARE;
  IF locked_parent IS DISTINCT FROM target THEN RAISE EXCEPTION 'Section changed during layout write' USING ERRCODE='23514'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM event_sessions WHERE venue_id=target) THEN
  RAISE EXCEPTION 'Layout is fixed after scheduling' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER event_sections_write_guard BEFORE INSERT OR UPDATE OR DELETE ON event_sections FOR EACH ROW EXECUTE FUNCTION guard_event_layout_write();
CREATE TRIGGER event_seats_write_guard BEFORE INSERT OR UPDATE OR DELETE ON event_seats FOR EACH ROW EXECUTE FUNCTION guard_event_layout_write();

CREATE FUNCTION check_event_layout() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE target UUID; expected INTEGER; actual BIGINT;
BEGIN
 -- Section deletion can remove the seat trigger's parent before commit. Keep
 -- validating that venue using the section trigger's captured OLD identity.
 IF TG_TABLE_NAME='event_sections' THEN
  target := CASE WHEN TG_OP='DELETE' THEN OLD.venue_id ELSE NEW.venue_id END;
 ELSE
  SELECT venue_id INTO target FROM event_sections WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.section_id ELSE NEW.section_id END;
 END IF;
 SELECT capacity INTO expected FROM event_venues WHERE id=target;
 SELECT count(*) INTO actual FROM event_seats JOIN event_sections ON event_sections.id=event_seats.section_id WHERE venue_id=target;
 IF expected IS NOT NULL AND actual<>0 AND actual<>expected THEN RAISE EXCEPTION 'Layout must match venue capacity' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER event_seats_complete_layout AFTER INSERT OR UPDATE OR DELETE ON event_seats DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_event_layout();
CREATE CONSTRAINT TRIGGER event_sections_complete_layout AFTER INSERT OR UPDATE OR DELETE ON event_sections DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_event_layout();

CREATE FUNCTION guard_event_venue_identity() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE actual BIGINT;
BEGIN
 PERFORM require_read_committed();
 IF NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'Venue identity cannot change' USING ERRCODE='23514'; END IF;
 IF (NEW.city_id IS DISTINCT FROM OLD.city_id OR NEW.capacity IS DISTINCT FROM OLD.capacity OR NEW.kind IS DISTINCT FROM OLD.kind)
 AND EXISTS(SELECT 1 FROM event_sessions WHERE venue_id=OLD.id) THEN
  RAISE EXCEPTION 'Scheduled venue identity and capacity are fixed' USING ERRCODE='23514';
 END IF;
 SELECT count(*) INTO actual FROM event_seats JOIN event_sections ON event_sections.id=event_seats.section_id WHERE venue_id=OLD.id;
 IF actual<>0 AND actual<>NEW.capacity THEN RAISE EXCEPTION 'Capacity must match layout' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER event_venues_identity_guard BEFORE UPDATE ON event_venues FOR EACH ROW EXECUTE FUNCTION guard_event_venue_identity();
CREATE FUNCTION guard_event_identity() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'Event identity cannot change' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER events_identity_guard BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION guard_event_identity();

CREATE FUNCTION guard_event_session_write() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE duration_value INTEGER; active_value BOOLEAN; expected INTEGER;
BEGIN
 PERFORM require_read_committed();
 IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.event_id IS DISTINCT FROM OLD.event_id OR NEW.venue_id IS DISTINCT FROM OLD.venue_id
 OR NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at) THEN
  RAISE EXCEPTION 'Session identity and time snapshot are fixed' USING ERRCODE='23514';
 END IF;
 SELECT capacity INTO expected FROM event_venues WHERE id=NEW.venue_id FOR UPDATE;
 SELECT duration_minutes,is_active INTO duration_value,active_value FROM events WHERE id=NEW.event_id FOR SHARE;
 IF TG_OP='INSERT' THEN
  IF active_value IS FALSE THEN RAISE EXCEPTION 'Inactive event cannot be scheduled' USING ERRCODE='23514'; END IF;
  IF NEW.ends_at IS NULL THEN NEW.ends_at := NEW.starts_at+duration_value*INTERVAL '1 minute'; END IF;
  IF NEW.ends_at IS DISTINCT FROM NEW.starts_at+duration_value*INTERVAL '1 minute' THEN
   RAISE EXCEPTION 'Session end must snapshot event duration' USING ERRCODE='23514';
  END IF;
 END IF;
 IF NEW.status='SCHEDULED' AND expected IS NOT NULL AND expected<>(SELECT count(*) FROM event_seats JOIN event_sections ON event_sections.id=event_seats.section_id WHERE venue_id=NEW.venue_id) THEN
  RAISE EXCEPTION 'Complete layout required for active session' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER event_sessions_write_guard BEFORE INSERT OR UPDATE ON event_sessions FOR EACH ROW EXECUTE FUNCTION guard_event_session_write();

CREATE FUNCTION guard_event_price_write() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 PERFORM require_read_committed();
 IF TG_OP='UPDATE' AND (NEW.session_id IS DISTINCT FROM OLD.session_id OR NEW.ticket_tier IS DISTINCT FROM OLD.ticket_tier) THEN
  RAISE EXCEPTION 'Price identity cannot change' USING ERRCODE='23514';
 END IF;
 PERFORM 1 FROM event_sessions WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.session_id ELSE NEW.session_id END FOR UPDATE;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER event_session_prices_write_guard BEFORE INSERT OR UPDATE OR DELETE ON event_session_prices FOR EACH ROW EXECUTE FUNCTION guard_event_price_write();
CREATE FUNCTION check_event_session_prices() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE target UUID; target_venue UUID; active_status "EventSessionStatus";
BEGIN
 IF TG_TABLE_NAME='event_sessions' THEN target := NEW.id;
 ELSE target := CASE WHEN TG_OP='DELETE' THEN OLD.session_id ELSE NEW.session_id END; END IF;
 SELECT venue_id,status INTO target_venue,active_status FROM event_sessions WHERE id=target FOR UPDATE;
 IF active_status='SCHEDULED' AND EXISTS(
  (SELECT DISTINCT ticket_tier FROM event_seats JOIN event_sections ON event_sections.id=event_seats.section_id WHERE venue_id=target_venue
   EXCEPT SELECT ticket_tier FROM event_session_prices WHERE session_id=target)
  UNION ALL
  (SELECT ticket_tier FROM event_session_prices WHERE session_id=target
   EXCEPT SELECT DISTINCT ticket_tier FROM event_seats JOIN event_sections ON event_sections.id=event_seats.section_id WHERE venue_id=target_venue)
 ) THEN RAISE EXCEPTION 'Active session requires exact tier price coverage' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER event_sessions_complete_prices AFTER INSERT OR UPDATE ON event_sessions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_event_session_prices();
CREATE CONSTRAINT TRIGGER event_session_prices_complete AFTER INSERT OR UPDATE OR DELETE ON event_session_prices DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_event_session_prices();
