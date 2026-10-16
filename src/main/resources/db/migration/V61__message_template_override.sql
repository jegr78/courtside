CREATE TABLE message_template_override (
    kind       text        NOT NULL,
    language   text        NOT NULL,
    subject    text        NOT NULL,
    body       text        NOT NULL,
    changed_at timestamptz NOT NULL,

    PRIMARY KEY (kind, language),
    CONSTRAINT message_template_override_language_known CHECK (language IN ('de', 'en')),
    CONSTRAINT message_template_override_subject_one_line CHECK (
        char_length(subject) BETWEEN 1 AND 200 AND subject !~ '[\r\n]'),
    CONSTRAINT message_template_override_body_length CHECK (char_length(body) BETWEEN 1 AND 10000)
);
