ALTER TABLE access_point
    ADD COLUMN loxone_group text,
    ADD CONSTRAINT access_point_loxone_group_shape CHECK (
        loxone_group ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{16}$');
