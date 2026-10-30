package org.courtside.rules.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.rules.BookingHorizon;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import java.util.Optional;

@Component
@RequiredArgsConstructor
class BookingHorizonQuery implements BookingHorizon {

    private final JdbcClient jdbc;

    @Override
    public Optional<Integer> longestAdvanceDays() {
        return jdbc.sql("""
                        SELECT max((params ->> 'maxDays')::int)
                        FROM rule_definition
                        WHERE rule_type = 'ADVANCE_WINDOW'
                        """)
                .query(Integer.class)
                .optional();
    }
}
