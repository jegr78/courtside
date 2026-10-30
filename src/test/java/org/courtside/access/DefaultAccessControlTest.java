package org.courtside.access;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.card.testfixture.CardTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;
import org.springframework.context.SmartLifecycle;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Import({FacilityTestFixture.class, IdentityTestFixture.class, BookingTestFixture.class, CardTestFixture.class})
class DefaultAccessControlTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");

    @Autowired
    private ApplicationContext context;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private BookingTestFixture bookings;

    @Autowired
    private CardTestFixture cards;

    @Autowired
    private JdbcClient jdbc;

    @Test
    void givenNoConnectorSelected_whenABookingThatOpensAGateIsMade_thenNoPassExistsAndNoGrantIsWritten() {
        // given
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        UUID court = facility.createCourt(1, "Court 1");
        facility.createAccessPoint("North gate", List.of(court), null);
        cards.letBookingsReceiveAccessCodes(MEMBER_BOOKING_CARD, true);
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        UUID account = identity.createEnabledAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        UUID john = identity.createPerson("John", "Roe", "john.roe@example.org");

        // when
        bookings.createBookingNamingMember(court, MEMBER_BOOKING_CARD, new TimeSlot(
                Instant.parse("2026-05-12T16:00:00Z"), Instant.parse("2026-05-12T17:00:00Z")), account, jane,
                Set.of(Role.MEMBER), null, john);

        // then
        assertThat(context.getBeansOfType(AccessControlConnector.class)).isEmpty();
        assertThat(context.getBeansOfType(SmartLifecycle.class).keySet()).noneMatch(name -> name.contains("access"));
        assertThat(jdbc.sql("SELECT count(*) FROM access_grant").query(Integer.class).single()).isZero();
    }
}
