ALTER TABLE club_config
    ADD COLUMN time_zone text NOT NULL DEFAULT 'Europe/Berlin',
    ADD CONSTRAINT club_config_time_zone_not_blank
        CHECK (length(btrim(time_zone)) > 0);

ALTER TABLE club_config ALTER COLUMN time_zone DROP DEFAULT;

