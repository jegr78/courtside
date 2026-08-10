CREATE TABLE booking_series (
    id               uuid PRIMARY KEY,
    card_id          uuid       NOT NULL REFERENCES booking_card,
    starts_on        date       NOT NULL,
    start_time       time       NOT NULL,
    duration_minutes smallint   NOT NULL,
    interval_weeks   smallint   NOT NULL,
    weekdays         smallint[] NOT NULL,
    ends_on          date,
    occurrence_count smallint,
    note             text,
    created_by       uuid,
    created_at       timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT booking_series_one_kind_of_end CHECK (
        (ends_on IS NOT NULL AND occurrence_count IS NULL)
        OR (ends_on IS NULL AND occurrence_count IS NOT NULL)
    ),
    CONSTRAINT booking_series_interval_positive CHECK (interval_weeks > 0),
    CONSTRAINT booking_series_duration_positive CHECK (duration_minutes > 0),
    CONSTRAINT booking_series_occurrence_count_positive CHECK (occurrence_count > 0),
    CONSTRAINT booking_series_has_a_weekday CHECK (array_length(weekdays, 1) > 0),
    CONSTRAINT booking_series_weekdays_range CHECK (1 <= ALL (weekdays) AND 7 >= ALL (weekdays))
);

CREATE TABLE booking_series_court (
    booking_series_id uuid     NOT NULL,
    court_id          uuid     NOT NULL,
    position          integer  NOT NULL,
    PRIMARY KEY (booking_series_id, court_id),
    CONSTRAINT booking_series_court_series_fk
        FOREIGN KEY (booking_series_id) REFERENCES booking_series ON DELETE CASCADE,
    CONSTRAINT booking_series_court_court_fk FOREIGN KEY (court_id) REFERENCES court,
    CONSTRAINT booking_series_court_unique_position UNIQUE (booking_series_id, position),
    CONSTRAINT booking_series_court_position_non_negative CHECK (position >= 0)
);

CREATE FUNCTION verify_booking_series_has_court() RETURNS trigger AS $$
DECLARE
    affected_series_id uuid;
BEGIN
    IF TG_TABLE_NAME = 'booking_series' THEN
        affected_series_id := NEW.id;
    ELSE
        affected_series_id := OLD.booking_series_id;
    END IF;

    PERFORM 1 FROM booking_series WHERE id = affected_series_id FOR UPDATE;
    IF FOUND AND NOT EXISTS (
           SELECT 1 FROM booking_series_court WHERE booking_series_id = affected_series_id
       ) THEN
        RAISE EXCEPTION 'Booking series % has no court', affected_series_id
            USING ERRCODE = '23514', CONSTRAINT = 'booking_series_has_a_court';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER booking_series_has_court_on_series
    AFTER INSERT OR UPDATE ON booking_series
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION verify_booking_series_has_court();

CREATE CONSTRAINT TRIGGER booking_series_has_court_on_court_removal
    AFTER DELETE OR UPDATE OF booking_series_id ON booking_series_court
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION verify_booking_series_has_court();

ALTER TABLE booking ADD COLUMN series_id uuid REFERENCES booking_series;

CREATE INDEX booking_by_series ON booking (series_id) WHERE series_id IS NOT NULL;
