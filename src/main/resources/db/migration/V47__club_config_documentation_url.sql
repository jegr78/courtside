ALTER TABLE club_config
    ADD COLUMN documentation_url text;

ALTER TABLE club_config
    ADD CONSTRAINT club_config_documentation_url_safe
        CHECK (documentation_url IS NULL OR documentation_url ~ '^(https?://\S+|/[^/\\\s]\S*|/)$');
