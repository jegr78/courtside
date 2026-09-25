ALTER TABLE club_config
    ADD COLUMN short_name text;

ALTER TABLE club_config
    ADD CONSTRAINT club_config_short_name_fits_an_icon_label
        CHECK (short_name IS NULL OR (length(btrim(short_name)) > 0 AND char_length(short_name) <= 12));
