CREATE TABLE person (
    id         uuid PRIMARY KEY,
    first_name text NOT NULL,
    last_name  text NOT NULL,
    email      text NOT NULL
);

CREATE TABLE user_account (
    id            uuid        PRIMARY KEY,
    person_id     uuid        NOT NULL REFERENCES person,
    username      text        NOT NULL,
    password_hash text        NOT NULL,
    locale        text        NOT NULL,
    enabled       boolean     NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz,
    CONSTRAINT user_account_unique_username UNIQUE (username),
    CONSTRAINT user_account_unique_person UNIQUE (person_id),
    CONSTRAINT user_account_locale_well_formed CHECK (locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$')
);

CREATE TABLE user_account_role (
    user_account_id uuid NOT NULL REFERENCES user_account ON DELETE CASCADE,
    role            text NOT NULL,
    PRIMARY KEY (user_account_id, role),
    CONSTRAINT user_account_role_role_known
        CHECK (role IN ('MEMBER', 'TRAINER', 'GROUNDSKEEPER', 'TREASURER', 'ADMIN'))
);

-- Lookup only: one email address serves several accounts when a parent registers for their
-- children, so it must not be unique.
CREATE INDEX person_by_email ON person (email);
