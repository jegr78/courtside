ALTER TABLE import_source
    ADD COLUMN column_mode  text    NOT NULL DEFAULT 'HEADER',
    ADD COLUMN column_count integer;

ALTER TABLE import_source ALTER COLUMN column_mode DROP DEFAULT;

ALTER TABLE import_source
    ADD CONSTRAINT import_source_column_mode_known CHECK (column_mode IN ('HEADER', 'POSITION')),
    ADD CONSTRAINT import_source_column_count_with_positions
        CHECK ((column_mode = 'HEADER' AND column_count IS NULL)
            OR (column_mode = 'POSITION' AND column_count BETWEEN 1 AND 200));

CREATE TABLE import_column_position (
    source_id       uuid    NOT NULL REFERENCES import_source ON DELETE CASCADE,
    position        integer NOT NULL,
    canonical_field text    NOT NULL,
    PRIMARY KEY (source_id, position),
    CONSTRAINT import_column_position_one_position_per_field UNIQUE (source_id, canonical_field),
    CONSTRAINT import_column_position_positive CHECK (position BETWEEN 1 AND 200),
    CONSTRAINT import_column_position_field_known
        CHECK (canonical_field IN ('EXTERNAL_ID', 'FIRST_NAME', 'LAST_NAME', 'EMAIL',
                                   'MEMBERSHIP_TYPE'))
);
