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

INSERT INTO member (id, person_id, membership_type_id) VALUES
    ('73000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001',
     'cccccccc-0000-0000-0000-000000000001'),
    ('73000000-0000-0000-0000-000000000002', '71000000-0000-0000-0000-000000000002',
     'cccccccc-0000-0000-0000-000000000002');

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
VALUES ('upgrade-fixture-primary', 'upgrade-fixture-session', 1735689600000, 1735689600000,
        1800, (extract(epoch FROM now() + interval '30 minutes') * 1000)::bigint, 'upgrade-member');

UPDATE club_config
SET club_name = 'Example Tennis Club', primary_color = '#123456', accent_color = '#ABCDEF',
    default_locale = 'en', slot_minutes = 15, time_zone = 'Europe/London';

COMMIT;
