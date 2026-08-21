CREATE INDEX domain_event_newest_idx ON domain_event (occurred_at DESC, id DESC);

-- Replaces V27's index: the id tiebreak makes it a superset, so the old shape adds nothing.
DROP INDEX domain_event_subject_idx;
CREATE INDEX domain_event_subject_idx ON domain_event (subject_id, occurred_at DESC, id DESC);
