CREATE TABLE guardian_relationship (
    id                  uuid PRIMARY KEY,
    guardian_person_id  uuid NOT NULL REFERENCES person,
    dependant_person_id uuid NOT NULL REFERENCES person,
    started_on          date NOT NULL,
    ended_on            date,
    CONSTRAINT guardian_relationship_two_people CHECK (guardian_person_id <> dependant_person_id),
    CONSTRAINT guardian_relationship_ends_after_start CHECK (ended_on IS NULL OR ended_on >= started_on),
    CONSTRAINT guardian_relationships_disjoint
        EXCLUDE USING gist (guardian_person_id WITH =, dependant_person_id WITH =,
                            daterange(started_on, ended_on, '[)') WITH &&)
);

CREATE INDEX guardian_relationship_dependant ON guardian_relationship (dependant_person_id);

CREATE TABLE guardian_relationship_action (
    guardian_relationship_id uuid NOT NULL REFERENCES guardian_relationship ON DELETE CASCADE,
    action                   text NOT NULL,
    PRIMARY KEY (guardian_relationship_id, action),
    CONSTRAINT guardian_relationship_action_known
        CHECK (action IN ('VIEW_BOOKINGS', 'BOOK', 'CANCEL_BOOKINGS', 'READ_MESSAGES', 'ACCOUNT_TASKS'))
);
