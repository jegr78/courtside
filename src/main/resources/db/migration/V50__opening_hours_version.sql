CREATE TABLE opening_hours_version (
    id             uuid PRIMARY KEY,
    effective_from date,
    CONSTRAINT opening_hours_version_unique_start UNIQUE (effective_from)
);

-- A NULL start means "since the beginning"; UNIQUE lets several NULLs through, this index does not.
CREATE UNIQUE INDEX opening_hours_version_single_origin
    ON opening_hours_version ((effective_from IS NULL)) WHERE effective_from IS NULL;

INSERT INTO opening_hours_version (id, effective_from)
VALUES ('eeeeeeee-0000-0000-0000-000000000100', NULL);

ALTER TABLE opening_hours ADD COLUMN version_id uuid
    REFERENCES opening_hours_version (id) ON DELETE CASCADE;
UPDATE opening_hours SET version_id = 'eeeeeeee-0000-0000-0000-000000000100';
ALTER TABLE opening_hours ALTER COLUMN version_id SET NOT NULL;

ALTER TABLE opening_hours DROP CONSTRAINT opening_hours_unique_day;
ALTER TABLE opening_hours ADD CONSTRAINT opening_hours_unique_day UNIQUE (version_id, day_of_week);
