package org.courtside.securityassessment;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingRepository;
import org.courtside.card.CardService;
import org.courtside.config.ClubIdentity;
import org.courtside.config.ClubTimeZone;
import org.courtside.facility.FacilityService;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccountRepository;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.MemberRepository;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

@Import({IdentityTestFixture.class, FacilityTestFixture.class})
class SecurityAssessmentReminderIsolationTest extends AbstractIntegrationTest {

    @Autowired
    private ApplicationContext context;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private BookingRepository bookings;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private PlatformTransactionManager transactions;

    @ParameterizedTest
    @ValueSource(strings = {"2026-10-27T08:46:00Z", "2026-10-27T22:59:00Z",
            "2026-10-24T08:46:00Z", "2026-03-28T08:46:00Z"})
    void givenFreshSecurityData_whenTheAssessmentCrossesAClockBoundary_thenNoReminderChangesProtectedRows(
            String startedAt) {
        // given
        Instant start = Instant.parse(startedAt);
        Instant end = start.plusSeconds(1800);
        identity.createEnabledAccount(identity.createPerson("Jane", "Doe"), "bootstrap-admin", Set.of(Role.ADMIN));
        facility.createCourt(1, "Court 1");
        SecurityAssessmentDataSeeder seeder = seederAt(start);
        TransactionTemplate transaction = new TransactionTemplate(transactions);
        transaction.executeWithoutResult(status -> seeder.run(new DefaultApplicationArguments(new String[0])));
        int leadHours = jdbc.sql("SELECT booking_reminder_hours FROM club_config").query(Integer.class).single();
        assertThat(leadHours).isEqualTo(24);
        assertThat(bookings.findDueForReminder(start, leadHours)).isEmpty();

        // when
        int claimed = transaction.execute(status -> bookings.findDueForReminder(end, leadHours).stream()
                .mapToInt(id -> bookings.claimReminder(id, end)).sum());

        // then
        assertThat(claimed).as("the real reminder claim must not mutate assessment seed rows").isZero();
        assertThat(jdbc.sql("SELECT count(*) FROM booking WHERE reminded_at IS NOT NULL")
                .query(Long.class).single()).isZero();
    }

    private SecurityAssessmentDataSeeder seederAt(Instant now) {
        return new SecurityAssessmentDataSeeder(context.getBean(ClubIdentity.class),
                context.getBean(PersonRepository.class), context.getBean(UserAccountRepository.class),
                context.getBean(MemberRepository.class), context.getBean(FacilityService.class),
                context.getBean(CardService.class), bookings, context.getBean(JdbcTemplate.class),
                context.getBean(PasswordEncoder.class),
                new SecurityAssessmentProperties(true, "run-0001", SecurityAssessmentDataset.fingerprint(),
                        "synthetic-password-value"),
                Clock.fixed(now, ZoneOffset.UTC), context.getBean(ClubTimeZone.class));
    }
}
