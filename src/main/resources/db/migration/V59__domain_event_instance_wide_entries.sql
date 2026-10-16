-- An activity about the whole instance, such as an export of a log, names no single subject.
ALTER TABLE domain_event ALTER COLUMN subject_id DROP NOT NULL;
