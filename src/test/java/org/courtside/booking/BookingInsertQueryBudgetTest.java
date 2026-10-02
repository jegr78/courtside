package org.courtside.booking;

import org.courtside.AbstractIntegrationTest;
import org.courtside.SqlStatementCounter;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Import({FacilityTestFixture.class, IdentityTestFixture.class})
class BookingInsertQueryBudgetTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");

    @Autowired
    private BookingRepository bookings;

    @Autowired
    private SqlStatementCounter queries;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    private Booking booking;

    @BeforeEach
    void setUp() {
        UUID court = facility.createCourt(1, "Court 1");
        UUID person = identity.createPerson("Jane", "Doe", "jane@example.org");
        booking = new Booking(MEMBER_CARD, UUID.randomUUID(), null, Instant.parse("2026-04-01T10:00:00Z"));
        booking.allocate(court, new TimeSlot(Instant.parse("2026-05-12T16:00:00Z"),
                Instant.parse("2026-05-12T17:00:00Z")));
        booking.addParticipant(ParticipantSpec.member(person));
        booking.addParticipant(ParticipantSpec.guest("Example Guest"));
    }

    @AfterEach
    void stopCounting() {
        queries.pause();
    }

    @Test
    void givenANewBookingAggregate_whenSaving_thenOnlyItsFourInsertsAreExecuted() {
        // given
        queries.reset();

        // when
        Booking saved = bookings.saveAndFlush(booking);
        var snapshot = queries.snapshot();
        queries.pause();

        // then
        assertThat(snapshot.total()).as(snapshot.toString()).isEqualTo(4);
        assertThat(saved.getId()).isEqualTo(booking.getId());
        assertThat(bookings.count()).isEqualTo(1);
    }

    @Test
    void givenASavedBooking_whenSavingItAgain_thenItUpdatesWithoutAnotherBookingInsert() {
        // given
        Booking saved = bookings.saveAndFlush(booking);
        UUID actor = UUID.randomUUID();
        saved.cancel(actor, Instant.parse("2026-04-02T10:00:00Z"));

        // when
        bookings.saveAndFlush(saved);

        // then
        Booking reloaded = bookings.findById(saved.getId()).orElseThrow();
        assertThat(reloaded.getStatus()).isEqualTo(BookingStatus.CANCELLED);
        assertThat(reloaded.getCancelledBy()).isEqualTo(actor);
        assertThat(bookings.count()).isEqualTo(1);
    }

    @Test
    void givenAReloadedBooking_whenSavingItAgain_thenItKeepsTheSamePersistedIdentity() {
        // given
        UUID id = bookings.saveAndFlush(booking).getId();
        Booking reloaded = bookings.findById(id).orElseThrow();

        // when
        Booking saved = bookings.saveAndFlush(reloaded);

        // then
        assertThat(saved.getId()).isEqualTo(id);
        assertThat(bookings.count()).isEqualTo(1);
    }
}
