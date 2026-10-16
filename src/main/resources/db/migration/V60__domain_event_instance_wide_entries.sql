-- An activity about the whole instance, such as an export of a log, names no single subject.
ALTER TABLE domain_event ALTER COLUMN subject_id DROP NOT NULL;
ALTER TABLE domain_event ADD CONSTRAINT domain_event_subject_required
    CHECK (subject_id IS NOT NULL OR event_type = 'dataexchange.log.exported');
