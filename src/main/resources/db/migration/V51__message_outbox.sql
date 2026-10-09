ALTER TABLE message_record
    ADD COLUMN attempts        integer     NOT NULL DEFAULT 0,
    ADD COLUMN retries         integer     NOT NULL DEFAULT 0,
    ADD COLUMN next_attempt_at timestamptz,
    ADD COLUMN parameters      jsonb       NOT NULL DEFAULT '{}';

-- A row still queued was mid-handover in a process that no longer exists, and nothing says for what.
UPDATE message_record
SET state = 'FAILED', settled_at = now(), reason = 'InterruptedBeforeOutbox'
WHERE state = 'QUEUED';

ALTER TABLE message_record
    ADD CONSTRAINT message_record_attempts_counted CHECK (attempts >= 0 AND retries >= 0),
    ADD CONSTRAINT message_record_due_while_queued CHECK (
        (state = 'QUEUED') = (next_attempt_at IS NOT NULL)),
    -- Booking and person ids are what a pending delivery reads, and a settled one needs none of them.
    ADD CONSTRAINT message_record_parameters_while_queued CHECK (
        state = 'QUEUED' OR parameters = '{}'::jsonb);

CREATE INDEX message_record_due_idx ON message_record (next_attempt_at) WHERE state = 'QUEUED';
