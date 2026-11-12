ALTER TABLE club_config
    ADD COLUMN read_notification_days integer NOT NULL DEFAULT 90,
    ADD CONSTRAINT club_config_read_notification_days_range CHECK (read_notification_days BETWEEN 1 AND 3650);

CREATE INDEX notification_read_idx ON notification (read_at) WHERE read_at IS NOT NULL;
