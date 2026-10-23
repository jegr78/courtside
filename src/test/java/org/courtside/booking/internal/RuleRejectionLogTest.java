package org.courtside.booking.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.config.ClubTimeZone;
import org.courtside.rules.RuleViolation;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

class RuleRejectionLogTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final List<RuleViolation> STARTS_IN_PAST = List.of(new RuleViolation("booking.rule.startsInPast", Map.of()));

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private ClubTimeZone clubTimeZone;

    @Autowired
    private UsageReportService usage;

    @Test
    void givenARefusalAtThirtySevenPastTen_whenItIsCounted_thenOnlyItsHourIsKept() {
        // when
        logAt("2026-05-12T10:37:12.345678Z").record(STARTS_IN_PAST, MEMBER_BOOKING_CARD);

        // then
        assertThat(rejectedAt()).as("the time a log could match is cut to the hour")
                .containsExactly(OffsetDateTime.parse("2026-05-12T10:00:00Z").toInstant());
    }

    @Test
    void givenARefusalFiveMinutesAfterClubMidnight_whenTheDaysAreReported_thenItCountsOnTheDayItHappened() {
        // given
        logAt("2026-05-11T22:05:00Z").record(STARTS_IN_PAST, MEMBER_BOOKING_CARD);

        // when
        long dayBefore = usage.report(LocalDate.of(2026, 5, 11), LocalDate.of(2026, 5, 11)).ruleRejections().attempts();
        long dayOf = usage.report(LocalDate.of(2026, 5, 12), LocalDate.of(2026, 5, 12)).ruleRejections().attempts();

        // then
        assertThat(rejectedAt()).as("00:05 in the club is cut to the club's midnight")
                .containsExactly(OffsetDateTime.parse("2026-05-11T22:00:00Z").toInstant());
        assertThat(List.of(dayBefore, dayOf)).as("the refusal belongs to the club-local day it happened on")
                .containsExactly(0L, 1L);
    }

    @Test
    void givenRepeatedCodesAndDifferentOpeningReasons_whenReported_thenEachAttemptCountsOncePerExactCode() {
        // given
        RuleViolation closed = new RuleViolation("booking.rule.openingHours.closed", Map.of());
        RuleViolation outside = new RuleViolation("booking.rule.openingHours.outside", Map.of());
        RuleRejectionLog log = logAt("2026-05-12T10:00:00Z");
        log.record(List.of(closed, closed, outside), MEMBER_BOOKING_CARD);
        log.record(List.of(closed), MEMBER_BOOKING_CARD);

        // when
        var refusals = usage.report(LocalDate.of(2026, 5, 12), LocalDate.of(2026, 5, 12)).ruleRejections();

        // then
        assertThat(refusals.attempts()).isEqualTo(2);
        assertThat(refusals.rules()).extracting("code", "attempts").containsExactlyInAnyOrder(
                tuple("booking.rule.openingHours.closed", 2L),
                tuple("booking.rule.openingHours.outside", 1L));
        assertThat(jdbc.sql("SELECT count(*) FROM booking_rule_rejection").query(Long.class).single()).isEqualTo(3);
    }

    private RuleRejectionLog logAt(String instant) {
        return new RuleRejectionLog(jdbc, clubTimeZone, Clock.fixed(Instant.parse(instant), ZoneOffset.UTC));
    }

    private List<Instant> rejectedAt() {
        return jdbc.sql("SELECT rejected_at FROM booking_rule_rejection")
                .query((rs, row) -> rs.getObject("rejected_at", OffsetDateTime.class).toInstant()).list();
    }
}
