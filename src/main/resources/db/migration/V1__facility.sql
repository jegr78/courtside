CREATE TABLE court (
    id     uuid PRIMARY KEY,
    number integer NOT NULL,
    name   text,
    active boolean NOT NULL DEFAULT true,
    CONSTRAINT court_unique_number UNIQUE (number),
    CONSTRAINT court_number_positive CHECK (number > 0)
);

CREATE TABLE opening_hours (
    id          uuid PRIMARY KEY,
    day_of_week integer NOT NULL,
    opens_at    time    NOT NULL,
    closes_at   time    NOT NULL,
    CONSTRAINT opening_hours_day_of_week_range CHECK (day_of_week BETWEEN 1 AND 7),
    CONSTRAINT opening_hours_valid_range CHECK (closes_at > opens_at),
    CONSTRAINT opening_hours_unique_day UNIQUE (day_of_week)
);
