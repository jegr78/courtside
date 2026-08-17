ALTER TABLE member
    ADD COLUMN started_on date NOT NULL DEFAULT CURRENT_DATE,
    ADD COLUMN ended_on   date;

ALTER TABLE member ALTER COLUMN started_on DROP DEFAULT;

ALTER TABLE member
    ADD CONSTRAINT member_period_ordered
        CHECK (ended_on IS NULL OR ended_on >= started_on);
