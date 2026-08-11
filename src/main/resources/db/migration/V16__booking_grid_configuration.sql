ALTER TABLE club_config
    ADD COLUMN slot_minutes integer NOT NULL DEFAULT 30,
    ADD CONSTRAINT club_config_slot_minutes_range
        CHECK (slot_minutes BETWEEN 5 AND 120 AND slot_minutes % 5 = 0);

ALTER TABLE club_config ALTER COLUMN slot_minutes DROP DEFAULT;
