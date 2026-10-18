ALTER TABLE member DROP CONSTRAINT member_unique_person;

ALTER TABLE member
    ADD CONSTRAINT member_periods_disjoint
        EXCLUDE USING gist (person_id WITH =, daterange(started_on, ended_on, '[)') WITH &&);
