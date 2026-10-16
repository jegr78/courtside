package org.courtside.booking.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubTimeZone;
import org.courtside.rules.RuleViolation;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Clock;
import java.util.Collection;
import java.util.UUID;

@Component
@RequiredArgsConstructor
public class RuleRejectionLog {

    private final JdbcClient jdbc;
    private final ClubTimeZone clubTimeZone;
    private final Clock clock;

    // Its own transaction, because the refused attempt rolls back; the club-local hour is all it keeps of when.
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(Collection<RuleViolation> violations, UUID cardId) {
        if (cardId == null) {
            throw new IllegalStateException("A refused attempt is counted against the card it asked for");
        }
        UUID attemptId = UUID.randomUUID();
        Timestamp now = Timestamp.from(clock.instant());
        violations.stream().map(RuleViolation::code).distinct().forEach(code -> jdbc.sql("""
                        INSERT INTO booking_rule_rejection (id, attempt_id, rule_code, rejected_at, card_id)
                        VALUES (:id, :attemptId, :ruleCode, date_trunc('hour', CAST(:now AS timestamptz), :zone), :cardId)
                        """)
                .param("id", UUID.randomUUID()).param("attemptId", attemptId).param("ruleCode", code)
                .param("now", now).param("zone", clubTimeZone.zoneId().getId()).param("cardId", cardId)
                .update());
    }
}
