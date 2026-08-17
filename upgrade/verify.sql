WITH captured(name, sort_key, row_data) AS (
    SELECT 'configuration', '', to_jsonb(c) FROM club_config c
    UNION ALL
    SELECT 'personRows', p.id::text, to_jsonb(p)
    FROM person p WHERE email LIKE '%-fixture@example.org'
    UNION ALL
    SELECT 'accountRows', a.id::text, to_jsonb(a)
    FROM user_account a WHERE id = '72000000-0000-0000-0000-000000000001'
    UNION ALL
    SELECT 'roleRows', r.user_account_id::text || ':' || r.role, to_jsonb(r)
    FROM user_account_role r WHERE user_account_id = '72000000-0000-0000-0000-000000000001'
    UNION ALL
    SELECT 'memberRows', m.id::text, to_jsonb(m)
    FROM member m WHERE id::text LIKE '73000000-0000-0000-0000-%'
    UNION ALL
    SELECT 'courtRows', c.id::text, to_jsonb(c)
    FROM court c WHERE id = '70000000-0000-0000-0000-000000000001'
    UNION ALL
    SELECT 'ruleSetRows', r.id::text, to_jsonb(r)
    FROM rule_set r WHERE id = '74000000-0000-0000-0000-000000000001'
    UNION ALL
    SELECT 'ruleRows', r.id::text, to_jsonb(r)
    FROM rule_definition r WHERE id = '75000000-0000-0000-0000-000000000001'
    UNION ALL
    SELECT 'bookingRows', b.id::text, to_jsonb(b)
    FROM booking b WHERE id::text LIKE '77000000-0000-0000-0000-%'
    UNION ALL
    SELECT 'allocationRows', a.id::text, to_jsonb(a)
    FROM court_allocation a WHERE id::text LIKE '78000000-0000-0000-0000-%'
    UNION ALL
    SELECT 'participantRows', p.id::text, to_jsonb(p)
    FROM booking_participant p WHERE id::text LIKE '79000000-0000-0000-0000-%'
    UNION ALL
    SELECT 'seriesRows', s.id::text, to_jsonb(s)
    FROM booking_series s WHERE id = '76000000-0000-0000-0000-000000000001'
    UNION ALL
    SELECT 'seriesCourtRows', c.booking_series_id::text || ':' || lpad(c.position::text, 10, '0'),
           to_jsonb(c)
    FROM booking_series_court c WHERE booking_series_id = '76000000-0000-0000-0000-000000000001'
    UNION ALL
    SELECT 'sessionRows', s.primary_id, to_jsonb(s)
    FROM spring_session s WHERE primary_id = 'upgrade-fixture-primary'
    UNION ALL
    SELECT 'loginLimitRows', l.scope || ':' || l.subject_hash, to_jsonb(l)
    FROM login_attempt_limit l WHERE subject_hash = repeat('b', 64)
),
redacted(name, sort_key, row_data) AS (
    SELECT name, sort_key, (
        SELECT jsonb_object_agg(key, CASE
                   WHEN value = 'null'::jsonb THEN value
                   WHEN key ~* '(password|secret|token|credential|hash|key)'
                       THEN to_jsonb(md5(value #>> '{}'))
                   ELSE value END)
        FROM jsonb_each(row_data))
    FROM captured
)
SELECT jsonb_build_object(
    'people', (SELECT count(*) FROM person),
    'accounts', (SELECT count(*) FROM user_account),
    'roles', (SELECT count(*) FROM user_account_role),
    'members', (SELECT count(*) FROM member),
    'courts', (SELECT count(*) FROM court),
    'ruleSets', (SELECT count(*) FROM rule_set),
    'rules', (SELECT count(*) FROM rule_definition),
    'bookings', (SELECT count(*) FROM booking),
    'allocations', (SELECT count(*) FROM court_allocation),
    'participants', (SELECT count(*) FROM booking_participant),
    'series', (SELECT count(*) FROM booking_series),
    'sessions', (SELECT count(*) FROM spring_session),
    'loginLimits', (SELECT count(*) FROM login_attempt_limit),
    'idempotencyRecords', (SELECT count(*) FROM booking WHERE idempotency_key IS NOT NULL),
    'configuration', (SELECT row_data FROM redacted WHERE name = 'configuration'),
    'personRows', (SELECT jsonb_agg(row_data ORDER BY sort_key) FROM redacted WHERE name = 'personRows'),
    'accountRows', (SELECT jsonb_agg(row_data ORDER BY sort_key) FROM redacted WHERE name = 'accountRows'),
    'roleRows', (SELECT jsonb_agg(row_data ORDER BY sort_key) FROM redacted WHERE name = 'roleRows'),
    'memberRows', (SELECT jsonb_agg(row_data ORDER BY sort_key) FROM redacted WHERE name = 'memberRows'),
    'courtRows', (SELECT jsonb_agg(row_data ORDER BY sort_key) FROM redacted WHERE name = 'courtRows'),
    'ruleSetRows', (SELECT jsonb_agg(row_data ORDER BY sort_key) FROM redacted WHERE name = 'ruleSetRows'),
    'ruleRows', (SELECT jsonb_agg(row_data ORDER BY sort_key) FROM redacted WHERE name = 'ruleRows'),
    'bookingRows', (SELECT jsonb_agg(row_data ORDER BY sort_key) FROM redacted WHERE name = 'bookingRows'),
    'allocationRows', (SELECT jsonb_agg(row_data ORDER BY sort_key) FROM redacted WHERE name = 'allocationRows'),
    'participantRows', (SELECT jsonb_agg(row_data ORDER BY sort_key) FROM redacted WHERE name = 'participantRows'),
    'seriesRows', (SELECT jsonb_agg(row_data ORDER BY sort_key) FROM redacted WHERE name = 'seriesRows'),
    'seriesCourtRows', (SELECT jsonb_agg(row_data ORDER BY sort_key) FROM redacted WHERE name = 'seriesCourtRows'),
    'sessionRows', (SELECT jsonb_agg(row_data ORDER BY sort_key) FROM redacted WHERE name = 'sessionRows'),
    'loginLimitRows', (SELECT jsonb_agg(row_data ORDER BY sort_key) FROM redacted WHERE name = 'loginLimitRows')
)::text;
