package org.courtside.notification;

import jakarta.mail.internet.MimeMessage;
import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.card.CardService;
import org.courtside.facility.FacilityService;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentCaptor.forClass;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

@Import({FacilityTestFixture.class, IdentityTestFixture.class})
class ClosureMessageTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");

    private static final Instant SIX_PM = Instant.parse("2026-05-13T16:00:00Z");
    private static final Instant SEVEN_PM = Instant.parse("2026-05-13T17:00:00Z");

    @MockitoSpyBean
    private JavaMailSender sender;

    @Autowired
    private BookingService bookings;

    @Autowired
    private FacilityService facility;

    @Autowired
    private CardService cards;

    @Autowired
    private FacilityTestFixture facilityFixture;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private JdbcClient jdbc;

    private UUID courtId;
    private UUID bookerPersonId;
    private UUID bookerAccountId;
    private UUID playerPersonId;
    private UUID playerAccountId;

    @BeforeEach
    void aClubWithABookingOnWednesdayEvening() {
        doNothing().when(sender).send(any(MimeMessage.class));
        courtId = facilityFixture.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facilityFixture.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        bookerPersonId = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        bookerAccountId = identity.createEnabledAccount(bookerPersonId, "doe.jane", Set.of(Role.MEMBER));
        playerPersonId = identity.createPerson("John", "Roe", "john.roe@example.org");
        playerAccountId = identity.createEnabledAccount(playerPersonId, "roe.john", Set.of(Role.MEMBER));
        book(courtId);
        clearInvocations(sender);
    }

    @Test
    void givenABookingOnACourt_whenTheCourtGoesOutOfService_thenEverybodyInItIsTold()
            throws Exception {
        // when
        facility.setCourtActive(courtId, false);

        // then — the board already sees which bookings sit on it; now so do the people in them
        assertThat(addressesWrittenTo())
                .containsExactlyInAnyOrder("jane.doe@example.org", "john.roe@example.org");
        assertThat(kindsRecorded()).contains("BOOKING_DISPLACED");
        assertThat(lastBodyTo("jane.doe@example.org"))
                .contains("Court 1", "13. Mai 2026", "18:00", "19:00");
    }

    @Test
    void givenABookingWithACard_whenThatCardGoesOutOfService_thenEverybodyInItIsTold()
            throws Exception {
        // when
        cards.setCardActive(MEMBER_BOOKING_CARD, false);

        // then
        assertThat(addressesWrittenTo()).contains("jane.doe@example.org");
        assertThat(lastBodyTo("jane.doe@example.org")).contains("Member booking");
    }

    @Test
    void givenABookingOnAWeekday_whenTheClubCloses_thenEverybodyInItIsTold() throws Exception {
        // when — the booking is on a Wednesday evening
        facility.closeOn(DayOfWeek.WEDNESDAY);

        // then
        assertThat(addressesWrittenTo()).contains("jane.doe@example.org");
    }

    @Test
    void givenABookingInTheEvening_whenTheClubClosesEarlier_thenEverybodyInItIsTold()
            throws Exception {
        // when — the booking runs to 19:00 and the day now ends at 17:00
        facility.setOpeningHours(DayOfWeek.WEDNESDAY,
                new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(17, 0)));

        // then
        assertThat(addressesWrittenTo()).contains("jane.doe@example.org");
        assertThat(lastBodyTo("jane.doe@example.org")).contains("13. Mai 2026");
    }

    @Test
    void givenABookingWithinTheHours_whenTheClubOpensLonger_thenNobodyIsTold() {
        // when
        facility.setOpeningHours(DayOfWeek.WEDNESDAY,
                new OpeningWindow(LocalTime.of(7, 0), LocalTime.of(23, 0)));

        // then — widening displaces nobody, and a message about it would be noise
        verify(sender, never()).send(any(MimeMessage.class));
    }

    @Test
    void givenAMemberWhoseAccountIsDeactivated_whenACourtGoesOutOfService_thenTheyAreNotWrittenTo()
            throws Exception {
        // given — somebody who has left the club keeps their bookings on the record
        identity.disableAccount(playerAccountId);

        // when
        facility.setCourtActive(courtId, false);

        // then
        assertThat(addressesWrittenTo()).containsExactly("jane.doe@example.org");
    }

    @Test
    void givenABookingOnAnotherCourt_whenACourtGoesOutOfService_thenNobodyIsTold() {
        // given
        UUID untouched = facilityFixture.createCourt(2, "Court 2");

        // when
        facility.setCourtActive(untouched, false);

        // then
        verify(sender, never()).send(any(MimeMessage.class));
    }

    @Test
    void givenACourtOutOfService_whenItComesBack_thenNothingIsSent() {
        // given
        facility.setCourtActive(courtId, false);
        clearInvocations(sender);

        // when
        facility.setCourtActive(courtId, true);

        // then
        verify(sender, never()).send(any(MimeMessage.class));
    }

    private void book(UUID court) {
        bookings.create(new CreateBookingCommand(List.of(court), MEMBER_BOOKING_CARD,
                new TimeSlot(SIX_PM, SEVEN_PM), bookerAccountId, bookerPersonId, Set.of(Role.MEMBER),
                null, List.of(ParticipantSpec.member(playerPersonId)), null));
    }

    private List<String> addressesWrittenTo() {
        var captured = forClass(MimeMessage.class);
        verify(sender, atLeastOnce()).send(captured.capture());
        return captured.getAllValues().stream().map(ClosureMessageTest::recipientOf).toList();
    }

    private String lastBodyTo(String address) throws Exception {
        var captured = forClass(MimeMessage.class);
        verify(sender, atLeastOnce()).send(captured.capture());
        return captured.getAllValues().stream()
                .filter(message -> address.equals(recipientOf(message)))
                .reduce((earlier, later) -> later)
                .orElseThrow(() -> new AssertionError("Nothing reached " + address))
                .getContent().toString();
    }

    private List<String> kindsRecorded() {
        return jdbc.sql("SELECT kind FROM message_record").query(String.class).list();
    }

    private static String recipientOf(MimeMessage message) {
        try {
            return message.getAllRecipients()[0].toString();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
