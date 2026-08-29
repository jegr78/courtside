ALTER TABLE club_config
    ADD COLUMN logo_content bytea,
    ADD COLUMN logo_media_type text,
    ADD COLUMN logo_digest text,
    ADD CONSTRAINT club_config_logo_complete CHECK (
        (logo_content IS NULL AND logo_media_type IS NULL AND logo_digest IS NULL)
        OR
        (logo_content IS NOT NULL AND logo_media_type IS NOT NULL AND logo_digest IS NOT NULL
            AND logo_media_type IN ('image/png', 'image/jpeg')
            AND logo_digest ~ '^[0-9a-f]{64}$')
    ),
    ADD CONSTRAINT club_config_logo_size CHECK (
        logo_content IS NULL OR octet_length(logo_content) BETWEEN 1 AND 1048576
    );
