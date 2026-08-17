CREATE TABLE import_external_reference (
    id          uuid        PRIMARY KEY,
    source_id   uuid        NOT NULL REFERENCES import_source,
    external_id text        NOT NULL,
    person_id   uuid        NOT NULL REFERENCES person,
    linked_at   timestamptz NOT NULL,
    CONSTRAINT import_external_reference_unique_external_id UNIQUE (source_id, external_id),
    CONSTRAINT import_external_reference_unique_person UNIQUE (source_id, person_id),
    CONSTRAINT import_external_reference_external_id_not_blank
        CHECK (length(btrim(external_id)) > 0)
);
