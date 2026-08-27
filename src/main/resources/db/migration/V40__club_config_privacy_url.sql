ALTER TABLE club_config
    ADD COLUMN privacy_url text;

ALTER TABLE club_config
    ADD CONSTRAINT club_config_privacy_url_safe
        CHECK (privacy_url IS NULL OR privacy_url ~ '^(https?://.+|/[^/\\].*|/)$');
