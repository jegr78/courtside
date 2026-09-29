BEGIN;

INSERT INTO court (id, number, name, active)
VALUES ('70000000-0000-0000-0000-000000000001', 7, 'Upgrade court', true);

INSERT INTO person (id, first_name, last_name, email) VALUES
    ('71000000-0000-0000-0000-000000000001', 'John', 'Roe', 'upgrade-fixture@example.org'),
    ('71000000-0000-0000-0000-000000000002', 'Mary', 'Major', 'history-fixture@example.org');

INSERT INTO user_account
    (id, person_id, username, password_hash, locale, enabled, created_at, password_change_required)
SELECT '72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001',
       'upgrade-member', password_hash, 'en', true, '2025-01-01T00:00:00Z', false
FROM user_account WHERE username = 'admin';

INSERT INTO user_account_role (user_account_id, role) VALUES
    ('72000000-0000-0000-0000-000000000001', 'MEMBER'),
    ('72000000-0000-0000-0000-000000000001', 'TRAINER');

INSERT INTO member (id, person_id, membership_type_id, started_on) VALUES
    ('73000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001',
     'cccccccc-0000-0000-0000-000000000001', '2024-01-01'),
    ('73000000-0000-0000-0000-000000000002', '71000000-0000-0000-0000-000000000002',
     'cccccccc-0000-0000-0000-000000000002', '2024-01-01');

INSERT INTO rule_set (id, name, active)
VALUES ('74000000-0000-0000-0000-000000000001', 'Upgrade rules', true);

INSERT INTO rule_definition (id, rule_set_id, rule_type, params)
VALUES ('75000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000001',
        'MAX_OPEN_BOOKINGS', '{"limit": 4}');

INSERT INTO booking_series
    (id, card_id, starts_on, start_time, duration_minutes, interval_weeks, weekdays,
     occurrence_count, note, created_by, created_at)
VALUES
    ('76000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
     '2025-01-06', '10:00', 60, 1, '{1}', 1, 'Synthetic upgrade series',
     '72000000-0000-0000-0000-000000000001', '2025-01-01T00:00:00Z');

INSERT INTO booking_series_court (booking_series_id, court_id, position)
VALUES ('76000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 0);

INSERT INTO booking
    (id, card_id, status, booked_by, note, created_at, series_id, idempotency_key, request_fingerprint)
VALUES
    ('77000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
     'CONFIRMED', '72000000-0000-0000-0000-000000000001', 'Synthetic upgrade booking',
     '2025-01-01T00:00:00Z', NULL, 'upgrade-fixture-booking', repeat('a', 64)),
    ('77000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
     'CONFIRMED', '72000000-0000-0000-0000-000000000001', 'Synthetic series occurrence',
     '2025-01-01T00:00:00Z', '76000000-0000-0000-0000-000000000001', NULL, NULL);

INSERT INTO court_allocation (id, booking_id, court_id, starts_at, ends_at, status) VALUES
    ('78000000-0000-0000-0000-000000000001', '77000000-0000-0000-0000-000000000001',
     '70000000-0000-0000-0000-000000000001', '2025-01-05T09:00:00Z', '2025-01-05T10:00:00Z', 'CONFIRMED'),
    ('78000000-0000-0000-0000-000000000002', '77000000-0000-0000-0000-000000000002',
     '70000000-0000-0000-0000-000000000001', '2025-01-06T09:00:00Z', '2025-01-06T10:00:00Z', 'CONFIRMED');

INSERT INTO booking_participant (id, booking_id, kind, person_id, position)
VALUES ('79000000-0000-0000-0000-000000000001', '77000000-0000-0000-0000-000000000001',
        'MEMBER', '71000000-0000-0000-0000-000000000001', 0);

INSERT INTO login_attempt_limit
    (scope, subject_hash, attempt_count, window_started_at, blocked_until)
VALUES ('GLOBAL', repeat('b', 64), 1, '2025-01-01T00:00:00Z', NULL);

INSERT INTO spring_session
    (primary_id, session_id, creation_time, last_access_time, max_inactive_interval, expiry_time, principal_name)
VALUES ('upgrade-fixture-primary', 'upgrade-fixture-session',
        (extract(epoch FROM now()) * 1000)::bigint, (extract(epoch FROM now()) * 1000)::bigint,
        86400, (extract(epoch FROM now() + interval '1 day') * 1000)::bigint, 'upgrade-member');

INSERT INTO domain_event (id, event_type, subject_id, actor_account_id, occurred_at, payload)
VALUES ('7a000000-0000-0000-0000-000000000001', 'UPGRADE_PROOF',
        '71000000-0000-0000-0000-000000000001',
        '72000000-0000-0000-0000-000000000001', '2025-01-01T00:00:00Z',
        '{"proof":"upgrade-fixture"}');

INSERT INTO spring_session_attributes (session_primary_id, attribute_name, attribute_bytes)
VALUES ('upgrade-fixture-primary', 'upgrade-fixture-attribute', '\x00'::bytea);

INSERT INTO credential_issue_limit (account_id, issued_count, window_started_at)
VALUES ('72000000-0000-0000-0000-000000000001', 1, '2025-01-01T00:00:00Z');

INSERT INTO password_reset_mail_limit (account_id, mailed_count, window_started_at)
VALUES ('72000000-0000-0000-0000-000000000001', 1, '2025-01-01T00:00:00Z');

INSERT INTO password_reset_token
    (account_id, code_hash, address_hash, security_epoch, created_at, expires_at)
VALUES ('72000000-0000-0000-0000-000000000001', repeat('c', 64), repeat('d', 64), 0,
        '2025-01-01T00:00:00Z', '2025-01-01T00:15:00Z');

INSERT INTO message_optout (user_account_id, kind, created_at)
VALUES ('72000000-0000-0000-0000-000000000001', 'BOOKING_REMINDER', '2025-01-01T00:00:00Z');

INSERT INTO message_record (id, account_id, kind, state, message_id, queued_at, settled_at)
VALUES ('7b000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001',
        'BOOKING_CONFIRMED', 'HANDED_OVER', '<upgrade-fixture@example.org>',
        '2025-01-01T00:00:00Z', '2025-01-01T00:00:05Z');

INSERT INTO event_publication
    (id, listener_id, event_type, serialized_event, publication_date, completion_date, status,
     completion_attempts)
VALUES ('7c000000-0000-0000-0000-000000000001', 'upgrade-fixture-listener', 'upgrade.fixture.Event', '{}',
        '2025-01-01T00:00:00Z', '2025-01-01T00:00:01Z', 'COMPLETED', 1);

INSERT INTO import_source
    (id, source_key, display_name, separator, encoding, default_membership_type_id,
     removal_warning_percent, created_at)
VALUES ('7d000000-0000-0000-0000-000000000001', 'upgrade-roster', 'Upgrade roster', ';', 'UTF-8',
        'cccccccc-0000-0000-0000-000000000001', 10, '2025-01-01T00:00:00Z');

INSERT INTO import_column_mapping (source_id, column_header, canonical_field) VALUES
    ('7d000000-0000-0000-0000-000000000001', 'Number', 'EXTERNAL_ID'),
    ('7d000000-0000-0000-0000-000000000001', 'Email', 'EMAIL');

INSERT INTO import_type_mapping (source_id, source_value, membership_type_id)
VALUES ('7d000000-0000-0000-0000-000000000001', 'Adult', 'cccccccc-0000-0000-0000-000000000001');

INSERT INTO import_owned_field (source_id, canonical_field)
VALUES ('7d000000-0000-0000-0000-000000000001', 'EMAIL');

INSERT INTO import_external_reference (id, source_id, external_id, person_id, linked_at)
VALUES ('7e000000-0000-0000-0000-000000000001', '7d000000-0000-0000-0000-000000000001', 'M-1',
        '71000000-0000-0000-0000-000000000001', '2025-01-01T00:00:00Z');

INSERT INTO import_preview
    (id, source_id, mode, file_name, file_hash, row_count, removal_count, removal_percent,
     removal_warning_pct, created_at, created_by_account_id, expires_at, superseded_at)
VALUES ('7e000000-0000-0000-0000-000000000002', '7d000000-0000-0000-0000-000000000001', 'UPDATE_ONLY',
        'roster.csv', repeat('e', 64), 1, 0, 0, 10, '2025-01-01T00:00:00Z',
        '72000000-0000-0000-0000-000000000001', '2025-01-01T01:00:00Z', '2025-01-01T00:30:00Z');

INSERT INTO import_run
    (id, source_id, preview_id, mode, file_hash, created_count, corrected_count, ended_count,
     accounts_disabled_count, roles_removed_count, row_error_count, removals_confirmed, executed_at,
     executed_by_account_id, accounts_created_count)
VALUES ('7e000000-0000-0000-0000-000000000003', '7d000000-0000-0000-0000-000000000001',
        '7e000000-0000-0000-0000-000000000002', 'UPDATE_ONLY', repeat('e', 64), 0, 1, 0, 0, 0, 0, false,
        '2025-01-01T00:20:00Z', '72000000-0000-0000-0000-000000000001', 0);

UPDATE club_config
SET club_name = 'Example Tennis Club', primary_color = '#123456', accent_color = '#ABCDEF',
    default_locale = 'en', slot_minutes = 15, time_zone = 'Europe/London';

COMMIT;
