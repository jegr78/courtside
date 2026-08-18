CREATE TABLE import_source (
    id                      uuid PRIMARY KEY,
    source_key              text        NOT NULL,
    display_name            text        NOT NULL,
    removal_warning_percent integer     NOT NULL,
    created_at              timestamptz NOT NULL,
    CONSTRAINT import_source_unique_key UNIQUE (source_key),
    CONSTRAINT import_source_key_not_blank CHECK (length(btrim(source_key)) > 0),
    CONSTRAINT import_source_display_name_not_blank CHECK (length(btrim(display_name)) > 0),
    CONSTRAINT import_source_removal_warning_percent_scale
        CHECK (removal_warning_percent BETWEEN 0 AND 100)
);

CREATE TABLE import_column_mapping (
    source_id       uuid NOT NULL REFERENCES import_source ON DELETE CASCADE,
    column_header   text NOT NULL,
    canonical_field text NOT NULL,
    PRIMARY KEY (source_id, column_header),
    CONSTRAINT import_column_mapping_one_header_per_field UNIQUE (source_id, canonical_field),
    CONSTRAINT import_column_mapping_field_known
        CHECK (canonical_field IN ('EXTERNAL_ID', 'FIRST_NAME', 'LAST_NAME', 'EMAIL',
                                   'MEMBERSHIP_TYPE')),
    CONSTRAINT import_column_mapping_header_not_blank CHECK (length(btrim(column_header)) > 0)
);

CREATE TABLE import_type_mapping (
    source_id          uuid NOT NULL REFERENCES import_source ON DELETE CASCADE,
    source_value       text NOT NULL,
    membership_type_id uuid NOT NULL REFERENCES membership_type,
    PRIMARY KEY (source_id, source_value),
    CONSTRAINT import_type_mapping_value_not_blank CHECK (length(btrim(source_value)) > 0)
);

CREATE TABLE import_owned_field (
    source_id       uuid NOT NULL REFERENCES import_source ON DELETE CASCADE,
    canonical_field text NOT NULL,
    PRIMARY KEY (source_id, canonical_field),
    CONSTRAINT import_owned_field_ownable
        CHECK (canonical_field IN ('FIRST_NAME', 'LAST_NAME', 'EMAIL', 'MEMBERSHIP_TYPE'))
);
