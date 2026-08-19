CREATE TABLE domain_event (
    id uuid PRIMARY KEY,
    event_type text NOT NULL,
    subject_id uuid NOT NULL,
    actor_account_id uuid,
    occurred_at timestamptz NOT NULL,
    payload jsonb NOT NULL
);

-- No foreign keys: an id whose row is gone is how section 11 erases a person from the log.
CREATE INDEX domain_event_subject_idx ON domain_event (subject_id, occurred_at);
CREATE INDEX domain_event_type_idx ON domain_event (event_type, occurred_at);

CREATE TABLE event_publication
(
  id                     UUID NOT NULL,
  listener_id            TEXT NOT NULL,
  event_type             TEXT NOT NULL,
  serialized_event       TEXT NOT NULL,
  publication_date       TIMESTAMP WITH TIME ZONE NOT NULL,
  completion_date        TIMESTAMP WITH TIME ZONE,
  status                 TEXT,
  completion_attempts    INT,
  last_resubmission_date TIMESTAMP WITH TIME ZONE,
  PRIMARY KEY (id)
);
CREATE INDEX event_publication_serialized_event_hash_idx ON event_publication USING hash(serialized_event);
CREATE INDEX event_publication_by_completion_date_idx ON event_publication (completion_date);
