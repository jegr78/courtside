SELECT jsonb_build_object(
    'people', (SELECT count(*) FROM person),
    'accounts', (SELECT count(*) FROM user_account),
    'roles', (SELECT count(*) FROM user_account_role),
    'members', (SELECT count(*) FROM member),
    'courts', (SELECT count(*) FROM court),
    'rules', (SELECT count(*) FROM rule_definition),
    'bookings', (SELECT count(*) FROM booking),
    'allocations', (SELECT count(*) FROM court_allocation),
    'participants', (SELECT count(*) FROM booking_participant),
    'series', (SELECT count(*) FROM booking_series),
    'sessions', (SELECT count(*) FROM spring_session),
    'idempotencyRecords', (SELECT count(*) FROM booking WHERE idempotency_key IS NOT NULL),
    'configuration', (SELECT md5(row_to_json(c)::text) FROM club_config c),
    'fixtureRows', (
        SELECT md5(string_agg(value, '|' ORDER BY value)) FROM (
            SELECT id::text AS value FROM person WHERE email LIKE '%-fixture@example.org'
            UNION ALL SELECT id::text FROM booking WHERE note LIKE 'Synthetic %'
            UNION ALL SELECT id::text FROM court WHERE name = 'Upgrade court'
        ) fixture
    )
)::text;
