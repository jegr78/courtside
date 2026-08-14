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
    'configuration', (SELECT md5(to_jsonb(c)::text) FROM club_config c),
    'personRows', (SELECT md5(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id))
                   FROM person p WHERE email LIKE '%-fixture@example.org'),
    'accountRows', (SELECT md5(string_agg(to_jsonb(a)::text, '|' ORDER BY a.id))
                    FROM user_account a WHERE id = '72000000-0000-0000-0000-000000000001'),
    'roleRows', (SELECT md5(string_agg(to_jsonb(r)::text, '|' ORDER BY r.user_account_id, r.role))
                 FROM user_account_role r WHERE user_account_id = '72000000-0000-0000-0000-000000000001'),
    'memberRows', (SELECT md5(string_agg(to_jsonb(m)::text, '|' ORDER BY m.id))
                   FROM member m WHERE id::text LIKE '73000000-0000-0000-0000-%'),
    'courtRows', (SELECT md5(string_agg(to_jsonb(c)::text, '|' ORDER BY c.id))
                  FROM court c WHERE id = '70000000-0000-0000-0000-000000000001'),
    'ruleSetRows', (SELECT md5(string_agg(to_jsonb(r)::text, '|' ORDER BY r.id))
                    FROM rule_set r WHERE id = '74000000-0000-0000-0000-000000000001'),
    'ruleRows', (SELECT md5(string_agg(to_jsonb(r)::text, '|' ORDER BY r.id))
                 FROM rule_definition r WHERE id = '75000000-0000-0000-0000-000000000001'),
    'bookingRows', (SELECT md5(string_agg(to_jsonb(b)::text, '|' ORDER BY b.id))
                    FROM booking b WHERE id::text LIKE '77000000-0000-0000-0000-%'),
    'allocationRows', (SELECT md5(string_agg(to_jsonb(a)::text, '|' ORDER BY a.id))
                       FROM court_allocation a WHERE id::text LIKE '78000000-0000-0000-0000-%'),
    'participantRows', (SELECT md5(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id))
                        FROM booking_participant p WHERE id::text LIKE '79000000-0000-0000-0000-%'),
    'seriesRows', (SELECT md5(string_agg(to_jsonb(s)::text, '|' ORDER BY s.id))
                   FROM booking_series s WHERE id = '76000000-0000-0000-0000-000000000001'),
    'seriesCourtRows', (SELECT md5(string_agg(to_jsonb(c)::text, '|' ORDER BY c.booking_series_id, c.position))
                        FROM booking_series_court c
                        WHERE booking_series_id = '76000000-0000-0000-0000-000000000001'),
    'sessionRows', (SELECT md5(string_agg(to_jsonb(s)::text, '|' ORDER BY s.primary_id))
                    FROM spring_session s WHERE primary_id = 'upgrade-fixture-primary'),
    'loginLimitRows', (SELECT md5(string_agg(to_jsonb(l)::text, '|' ORDER BY l.scope, l.subject_hash))
                       FROM login_attempt_limit l WHERE subject_hash = repeat('b', 64))
)::text;
