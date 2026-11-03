CREATE TABLE import_left_out_category (
    source_id    uuid NOT NULL REFERENCES import_source ON DELETE CASCADE,
    source_value text NOT NULL,
    PRIMARY KEY (source_id, source_value),
    CONSTRAINT import_left_out_category_value_not_blank CHECK (length(btrim(source_value)) > 0)
);
