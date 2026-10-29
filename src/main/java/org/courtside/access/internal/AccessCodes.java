package org.courtside.access.internal;

import org.courtside.config.AccessCodeLength;
import org.jspecify.annotations.Nullable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import java.util.random.RandomGenerator;

@Component
class AccessCodes {

    static final int DRAWS = 20;

    private final JdbcClient jdbc;
    private final RandomGenerator random;

    @Autowired
    AccessCodes(JdbcClient jdbc) {
        this(jdbc, new SecureRandom());
    }

    AccessCodes(JdbcClient jdbc, RandomGenerator random) {
        this.jdbc = jdbc;
        this.random = random;
    }

    String draw(UUID grantId, AccessCodeLength length) {
        if (grantId == null || length == null) {
            throw new IllegalStateException("A code is drawn for a grant and the club's code length");
        }
        for (int draw = 0; draw < DRAWS; draw++) {
            String code = candidate(length.digits());
            int inserted = jdbc.sql("""
                            INSERT INTO access_code (code, grant_id)
                            SELECT :drawn, :grant
                            WHERE NOT EXISTS (SELECT 1 FROM access_point WHERE static_code = :drawn)
                            ON CONFLICT (code) DO NOTHING
                            """)
                    .param("drawn", code).param("grant", grantId).update();
            if (inserted == 1) {
                return code;
            }
        }
        throw new NoFreeAccessCodeException(length.digits(), DRAWS);
    }

    void detach(UUID grantId, @Nullable Instant until) {
        if (grantId == null) {
            throw new IllegalStateException("A code is detached from a grant");
        }
        jdbc.sql("UPDATE access_code SET grant_id = NULL, until = :until WHERE grant_id = :grant")
                .param("until", until == null ? null : Timestamp.from(until)).param("grant", grantId).update();
    }

    int deleteExpired(Instant dbNow) {
        if (dbNow == null) {
            throw new IllegalStateException("Expired codes are deleted against the database's time");
        }
        return jdbc.sql("DELETE FROM access_code WHERE grant_id IS NULL AND (until IS NULL OR until <= :now)")
                .param("now", Timestamp.from(dbNow)).update();
    }

    private String candidate(int digits) {
        StringBuilder code = new StringBuilder(digits);
        for (int digit = 0; digit < digits; digit++) {
            code.append((char) ('0' + random.nextInt(10)));
        }
        return code.toString();
    }
}
