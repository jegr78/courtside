CREATE TABLE club_config (
    id             uuid PRIMARY KEY,
    club_name      text NOT NULL,
    primary_color  text NOT NULL,
    accent_color   text NOT NULL,
    logo_url       text,
    imprint_url    text,
    default_locale text NOT NULL,

    CONSTRAINT club_config_single_row CHECK (id = '00000000-0000-0000-0000-000000000001'),
    CONSTRAINT club_config_name_not_blank CHECK (length(btrim(club_name)) > 0),
    CONSTRAINT club_config_primary_color_hex CHECK (primary_color ~ '^#[0-9a-fA-F]{6}$'),
    CONSTRAINT club_config_accent_color_hex CHECK (accent_color ~ '^#[0-9a-fA-F]{6}$'),
    CONSTRAINT club_config_locale_well_formed CHECK (default_locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
    CONSTRAINT club_config_logo_url_safe CHECK (logo_url IS NULL OR logo_url ~ '^(https://\S+|/[^/\\\s]\S*|/)$'),
    CONSTRAINT club_config_imprint_url_safe CHECK (imprint_url IS NULL OR imprint_url ~ '^(https?://\S+|/[^/\\\s]\S*|/)$')
);

INSERT INTO club_config (id, club_name, primary_color, accent_color, default_locale)
VALUES ('00000000-0000-0000-0000-000000000001', 'Courtside', '#AF5030', '#D7E24B', 'de');
