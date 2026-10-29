CREATE TABLE access_point (
    id          uuid    PRIMARY KEY,
    name        text    NOT NULL,
    static_code text,
    active      boolean NOT NULL DEFAULT true,
    CONSTRAINT access_point_unique_name UNIQUE (name),
    CONSTRAINT access_point_name_not_blank CHECK (length(btrim(name)) > 0),
    CONSTRAINT access_point_name_length CHECK (length(name) <= 60),
    CONSTRAINT access_point_static_code_digits CHECK (static_code ~ '^[0-9]{4,8}$')
);

CREATE TABLE access_point_court (
    access_point_id uuid NOT NULL REFERENCES access_point ON DELETE CASCADE,
    court_id        uuid NOT NULL REFERENCES court,
    PRIMARY KEY (access_point_id, court_id)
);

CREATE INDEX access_point_court_court ON access_point_court (court_id);

ALTER TABLE booking_card
    ADD COLUMN grants_access boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT booking_card_closure_grants_no_access CHECK (
        NOT grants_access OR id <> '44444444-4444-4444-4444-444444444444');

ALTER TABLE club_config
    ADD COLUMN access_lead_minutes integer NOT NULL DEFAULT 15,
    ADD COLUMN access_lag_minutes  integer NOT NULL DEFAULT 15,
    ADD COLUMN access_code_length  integer NOT NULL DEFAULT 6,
    ADD CONSTRAINT club_config_access_lead_minutes_range CHECK (access_lead_minutes BETWEEN 0 AND 240),
    ADD CONSTRAINT club_config_access_lag_minutes_range CHECK (access_lag_minutes BETWEEN 0 AND 240),
    ADD CONSTRAINT club_config_access_code_length_range CHECK (access_code_length BETWEEN 4 AND 8);
