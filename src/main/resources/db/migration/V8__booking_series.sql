CREATE TABLE booking_series (
    id               uuid PRIMARY KEY,
    card_id          uuid       NOT NULL REFERENCES booking_card,
    court_ids        uuid[]     NOT NULL,
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
    CONSTRAINT booking_series_has_a_court CHECK (array_length(court_ids, 1) > 0),
    CONSTRAINT booking_series_weekdays_range CHECK (1 <= ALL (weekdays) AND 7 >= ALL (weekdays))
);

ALTER TABLE booking ADD COLUMN series_id uuid REFERENCES booking_series;

CREATE INDEX booking_by_series ON booking (series_id) WHERE series_id IS NOT NULL;
