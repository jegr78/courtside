CREATE TABLE rule_set (
    id     uuid PRIMARY KEY,
    name   text    NOT NULL,
    active boolean NOT NULL DEFAULT true,
    CONSTRAINT rule_set_unique_name UNIQUE (name),
    CONSTRAINT rule_set_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE TABLE rule_definition (
    id          uuid  PRIMARY KEY,
    rule_set_id uuid  NOT NULL REFERENCES rule_set ON DELETE CASCADE,
    rule_type   text  NOT NULL,
    params      jsonb NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT rule_definition_unique_type_per_set UNIQUE (rule_set_id, rule_type),
    CONSTRAINT rule_definition_rule_type_known
        CHECK (rule_type IN ('OPENING_HOURS', 'SLOT_GRID', 'ADVANCE_WINDOW', 'MAX_OPEN_BOOKINGS',
                             'MAX_BOOKING_DURATION', 'CANCELLATION_DEADLINE', 'NO_COURT_BOOKING'))
);

CREATE TABLE membership_type (
    id          uuid PRIMARY KEY,
    name        text    NOT NULL,
    rule_set_id uuid REFERENCES rule_set,
    active      boolean NOT NULL DEFAULT true,
    CONSTRAINT membership_type_unique_name UNIQUE (name),
    CONSTRAINT membership_type_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE TABLE member (
    id                 uuid PRIMARY KEY,
    person_id          uuid NOT NULL REFERENCES person,
    membership_type_id uuid NOT NULL REFERENCES membership_type,
    CONSTRAINT member_unique_person UNIQUE (person_id)
);

INSERT INTO rule_set (id, name) VALUES
    ('aaaaaaaa-0000-0000-0000-000000000001', 'Standard'),
    ('aaaaaaaa-0000-0000-0000-000000000002', 'Youth');

INSERT INTO rule_definition (id, rule_set_id, rule_type, params) VALUES
    ('bbbbbbbb-0000-0000-0000-000000000001',
     'aaaaaaaa-0000-0000-0000-000000000001', 'ADVANCE_WINDOW',    '{"maxDays": 7}'),
    ('bbbbbbbb-0000-0000-0000-000000000002',
     'aaaaaaaa-0000-0000-0000-000000000001', 'MAX_OPEN_BOOKINGS', '{"limit": 2}'),
    ('bbbbbbbb-0000-0000-0000-000000000003',
     'aaaaaaaa-0000-0000-0000-000000000002', 'ADVANCE_WINDOW',    '{"maxDays": 3}'),
    ('bbbbbbbb-0000-0000-0000-000000000004',
     'aaaaaaaa-0000-0000-0000-000000000002', 'MAX_OPEN_BOOKINGS', '{"limit": 1}');

INSERT INTO membership_type (id, name, rule_set_id) VALUES
    ('cccccccc-0000-0000-0000-000000000001', 'Active', 'aaaaaaaa-0000-0000-0000-000000000001'),
    ('cccccccc-0000-0000-0000-000000000002', 'Youth',  'aaaaaaaa-0000-0000-0000-000000000002');
