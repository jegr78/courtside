package org.courtside.booking.waitlist;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Import({FacilityTestFixture.class, IdentityTestFixture.class, MemberTestFixture.class, BookingTestFixture.class})
class PendingBookingWaitlistTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final TimeSlot SLOT = new TimeSlot(
            Instant.parse("2026-05-12T16:00:00Z"), Instant.parse("2026-05-12T17:00:00Z"));
    private static final Instant EXPIRY = Instant.parse("2026-05-12T10:15:00Z");

    @Autowired
    private WaitlistQueue queue;
    @Autowired
    private BookingTestFixture bookings;
    @Autowired
    private FacilityTestFixture facility;
    @Autowired
    private IdentityTestFixture identity;
    @Autowired
    private MemberTestFixture members;
    @Autowired
    private JdbcClient jdbc;

    private UUID court;
    private UUID waitingAccount;
    private UUID waitingPerson;
    private UUID holderPerson;

    @BeforeEach
    void aPendingBookingOnOneCourt() {
        court = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        holderPerson = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        UUID holderAccount = identity.createEnabledAccount(holderPerson, "doe.jane", Set.of(Role.MEMBER));
        members.holdRunningMembership(holderPerson);
        waitingPerson = identity.createPerson("John", "Roe", "john.roe@example.org");
        waitingAccount = identity.createEnabledAccount(waitingPerson, "roe.john", Set.of(Role.MEMBER));
        members.holdRunningMembership(waitingPerson);
        bookings.createPendingBooking(court, MEMBER_CARD, SLOT, holderAccount, EXPIRY);
    }

    @Test
    void givenAPendingBooking_whenAnotherMemberJoinsTheWaitlistAndTheQueueIsSwept_thenTheSlotIsOccupiedAndNothingIsOffered() {
        // when
        UUID entry = bookings.joinWaitlist(court, MEMBER_CARD, SLOT, waitingAccount, waitingPerson, holderPerson);
        queue.sweep();

        // then
        String state = jdbc.sql("SELECT state FROM waitlist_entry WHERE id = ?").param(entry)
                .query(String.class).single();
        assertThat(state).as("state of the entry queued for the held slot").isEqualTo("WAITING");
    }
}
