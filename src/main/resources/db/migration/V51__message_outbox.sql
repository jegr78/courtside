ALTER TABLE message_record
    ADD COLUMN attempts        integer     NOT NULL DEFAULT 0,
    ADD COLUMN next_attempt_at timestamptz,
    ADD COLUMN parameters      jsonb       NOT NULL DEFAULT '{}';

UPDATE message_record SET next_attempt_at = queued_at WHERE state = 'QUEUED';

ALTER TABLE message_record
    ADD CONSTRAINT message_record_attempts_counted CHECK (attempts >= 0),
    ADD CONSTRAINT message_record_due_while_queued CHECK (
        (state = 'QUEUED') = (next_attempt_at IS NOT NULL)),
    -- Booking and person ids are what a pending delivery reads, and a settled one needs none of them.
    ADD CONSTRAINT message_record_parameters_while_queued CHECK (
        state = 'QUEUED' OR parameters = '{}'::jsonb);

CREATE INDEX message_record_due_idx ON message_record (next_attempt_at) WHERE state = 'QUEUED';
