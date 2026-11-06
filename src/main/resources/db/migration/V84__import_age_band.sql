ALTER TABLE import_column_mapping
    DROP CONSTRAINT import_column_mapping_field_known,
    ADD CONSTRAINT import_column_mapping_field_known
        CHECK (canonical_field IN ('EXTERNAL_ID', 'FIRST_NAME', 'LAST_NAME', 'EMAIL', 'MEMBERSHIP_TYPE',
                                   'BIRTH_DATE'));

ALTER TABLE import_column_position
    DROP CONSTRAINT import_column_position_field_known,
    ADD CONSTRAINT import_column_position_field_known
        CHECK (canonical_field IN ('EXTERNAL_ID', 'FIRST_NAME', 'LAST_NAME', 'EMAIL', 'MEMBERSHIP_TYPE',
                                   'BIRTH_DATE'));

CREATE TABLE import_age_band (
    source_id          uuid    NOT NULL REFERENCES import_source ON DELETE CASCADE,
    source_value       text    NOT NULL,
    lower_bound        integer NOT NULL,
    membership_type_id uuid    NOT NULL REFERENCES membership_type,
    PRIMARY KEY (source_id, source_value, lower_bound),
    CONSTRAINT import_age_band_split_has_fallback FOREIGN KEY (source_id, source_value)
        REFERENCES import_type_mapping (source_id, source_value) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT import_age_band_bound_range CHECK (lower_bound BETWEEN 0 AND 150)
);
