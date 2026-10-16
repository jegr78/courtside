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
import java.time.Instant;
import java.time.LocalDate;
import java.util.Collection;
import java.util.UUID;

@Component
@RequiredArgsConstructor
public class RuleRejectionLog {

    private final JdbcClient jdbc;
    private final ClubTimeZone clubTimeZone;
    private final Clock clock;

    // Its own transaction, because the refused attempt rolls back; it keeps nothing that names the holder.
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(Collection<RuleViolation> violations, UUID cardId, UUID holderPersonId, UUID holderAccountId) {
        if (cardId == null) {
            throw new IllegalStateException("A refused attempt is counted against the card it asked for");
        }
        Instant now = clock.instant();
        LocalDate today = LocalDate.ofInstant(now, clubTimeZone.zoneId());
        UUID attemptId = UUID.randomUUID();
        violations.stream().map(RuleViolation::code).distinct().forEach(code -> jdbc.sql("""
                        INSERT INTO booking_rule_rejection
                            (id, attempt_id, rule_code, rejected_at, card_id, membership_type_id)
                        SELECT :id, :attemptId, :code, :rejectedAt, :cardId,
                               (SELECT m.membership_type_id FROM member m
                                 WHERE m.person_id = COALESCE(CAST(:personId AS uuid),
                                           (SELECT u.person_id FROM user_account u WHERE u.id = :accountId))
                                   AND m.started_on <= :today
                                   AND (m.ended_on IS NULL OR m.ended_on > :today))
                        """)
                .param("id", UUID.randomUUID()).param("attemptId", attemptId).param("code", code)
                .param("rejectedAt", Timestamp.from(now)).param("cardId", cardId)
                .param("personId", holderPersonId).param("accountId", holderAccountId).param("today", today)
                .update());
    }
}
