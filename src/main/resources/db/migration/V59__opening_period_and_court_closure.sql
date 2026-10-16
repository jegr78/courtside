CREATE TABLE opening_period (
    id        uuid PRIMARY KEY,
    kind      text NOT NULL,
    name      text NOT NULL,
    starts_on date NOT NULL,
    ends_on   date NOT NULL,

    CONSTRAINT opening_period_kind_known CHECK (kind IN ('SEASON', 'HOLIDAY')),
    CONSTRAINT opening_period_name_length CHECK (char_length(name) BETWEEN 1 AND 80),
    CONSTRAINT opening_period_valid_range CHECK (ends_on >= starts_on),
    CONSTRAINT opening_period_no_overlap EXCLUDE USING gist (
        kind WITH =,
        daterange(starts_on, ends_on, '[]') WITH &&
    )
);

CREATE TABLE opening_period_hours (
    period_id   uuid NOT NULL REFERENCES opening_period ON DELETE CASCADE,
    day_of_week int  NOT NULL,
    opens_at    time NOT NULL,
    closes_at   time NOT NULL,

    PRIMARY KEY (period_id, day_of_week),
    CONSTRAINT opening_period_hours_day_of_week_range CHECK (day_of_week BETWEEN 1 AND 7),
    CONSTRAINT opening_period_hours_valid_range CHECK (closes_at > opens_at)
);

CREATE TABLE court_closure (
    id        uuid PRIMARY KEY,
    court_id  uuid NOT NULL REFERENCES court,
    name      text NOT NULL,
    starts_on date NOT NULL,
    ends_on   date NOT NULL,

    CONSTRAINT court_closure_name_length CHECK (char_length(name) BETWEEN 1 AND 80),
    CONSTRAINT court_closure_valid_range CHECK (ends_on >= starts_on),
    CONSTRAINT court_closure_no_overlap EXCLUDE USING gist (
        court_id WITH =,
        daterange(starts_on, ends_on, '[]') WITH &&
    )
);
