package org.courtside.notification;

import jakarta.mail.internet.MimeMessage;
import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.config.testfixture.ConfigTestFixture;
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
import java.time.ZoneOffset;
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
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

@Import({FacilityTestFixture.class, IdentityTestFixture.class, ConfigTestFixture.class,
        BookingTestFixture.class})
class BookingReminderTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");

    private static final Instant SIX_PM = Instant.parse("2026-05-12T16:00:00Z");
    private static final Instant SEVEN_PM = Instant.parse("2026-05-12T17:00:00Z");
    private static final Instant IN_SIX_WEEKS = Instant.parse("2026-06-24T16:00:00Z");
    private static final Instant A_DAY_AHEAD = Instant.parse("2026-05-13T10:00:00Z");
    private static final Instant A_WEEK_EARLIER = Instant.parse("2026-05-05T10:00:00Z");

    @MockitoSpyBean
    private JavaMailSender sender;

    @Autowired
    private BookingService bookings;

    @Autowired
    private BookingTestFixture reminders;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private ConfigTestFixture configuration;

    @Autowired
    private JdbcClient jdbc;

    private UUID courtId;
    private UUID bookerPersonId;
    private UUID bookerAccountId;
    private UUID playerPersonId;

    @BeforeEach
    void aClubThatRemindsADayAhead() {
        doNothing().when(sender).send(any(MimeMessage.class));
        courtId = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        bookerPersonId = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        bookerAccountId = identity.createEnabledAccount(bookerPersonId, "doe.jane", Set.of(Role.MEMBER));
        playerPersonId = identity.createPerson("John", "Roe", "john.roe@example.org");
        identity.createEnabledAccount(playerPersonId, "roe.john", Set.of(Role.MEMBER));
    }

    @Test
    void givenABookingWithinTheLeadTime_whenTheSweepRuns_thenEverybodyInItIsReminded()
            throws Exception {
        // given — the club reminds a day ahead, and the booking is this evening
        bookedLongBeforeItsLeadTime(SIX_PM, SEVEN_PM);
        clearInvocations(sender);

        // when
        reminders.remindWhatIsDue();

        // then
        assertThat(addressesWrittenTo())
                .containsExactlyInAnyOrder("jane.doe@example.org", "john.roe@example.org");
        assertThat(lastBodyTo("jane.doe@example.org")).contains("12. Mai 2026", "18:00", "Court 1");
        assertThat(kindsRecorded()).contains("BOOKING_REMINDER");
    }

    @Test
    void givenABookingBeyondTheLeadTime_whenTheSweepRuns_thenItIsNotRemindedYet() {
        // given
        book(IN_SIX_WEEKS, IN_SIX_WEEKS.plusSeconds(3600));
        clearInvocations(sender);

        // when
        reminders.remindWhatIsDue();

        // then
        verify(sender, never()).send(any(MimeMessage.class));
    }

    @Test
    void givenAReminderAlreadySent_whenTheSweepRunsAgain_thenNobodyIsRemindedTwice()
            throws Exception {
        // given
        bookedLongBeforeItsLeadTime(SIX_PM, SEVEN_PM);
        clearInvocations(sender);
        reminders.remindWhatIsDue();

        // when
        reminders.remindWhatIsDue();

        // then — the claim on the booking is what makes the second sweep find nothing
        verify(sender, times(2)).send(any(MimeMessage.class));
    }

    @Test
    void givenAClubThatWantsNoReminders_whenTheSweepRuns_thenNothingGoesOut() {
        // given
        bookedLongBeforeItsLeadTime(SIX_PM, SEVEN_PM);
        configuration.remindBookingsAfter(0);
        clearInvocations(sender);

        // when
        reminders.remindWhatIsDue();

        // then
        verify(sender, never()).send(any(MimeMessage.class));
        assertThat(jdbc.sql("SELECT reminded_at FROM booking").query().listOfRows())
                .allSatisfy(row -> assertThat(row.get("reminded_at")).isNull());
    }

    @Test
    void givenABookingMadeInsideItsOwnLeadTime_whenTheSweepRuns_thenItsConfirmationStandsForIt() {
        // given — booked this morning for this evening, which the confirmation already announced
        book(SIX_PM, SEVEN_PM);
        clearInvocations(sender);

        // when
        reminders.remindWhatIsDue();

        // then
        verify(sender, never()).send(any(MimeMessage.class));
    }

    @Test
    void givenABookingStartingExactlyAtTheLeadTime_whenTheSweepRuns_thenItIsReminded()
            throws Exception {
        // given — the edge of the window belongs to it, on both the start and the booked-at side
        book(A_DAY_AHEAD, A_DAY_AHEAD.plusSeconds(3600));
        clearInvocations(sender);

        // when
        reminders.remindWhatIsDue();

        // then
        assertThat(addressesWrittenTo()).contains("jane.doe@example.org");
    }

    @Test
    void givenACancelledBooking_whenTheSweepRuns_thenNobodyHearsAboutIt() {
        // given
        UUID cancelled = bookedLongBeforeItsLeadTime(SIX_PM, SEVEN_PM);
        bookings.cancel(cancelled, bookerAccountId, Set.of(Role.MEMBER));
        clearInvocations(sender);

        // when
        reminders.remindWhatIsDue();

        // then
        verify(sender, never()).send(any(MimeMessage.class));
    }

    private UUID book(Instant from, Instant to) {
        return bookings.create(new CreateBookingCommand(List.of(courtId), MEMBER_BOOKING_CARD,
                new TimeSlot(from, to), bookerAccountId, bookerPersonId, Set.of(Role.MEMBER),
                null, List.of(ParticipantSpec.member(playerPersonId)), null));
    }

    private UUID bookedLongBeforeItsLeadTime(Instant from, Instant to) {
        UUID bookingId = book(from, to);
        jdbc.sql("UPDATE booking SET created_at = :at WHERE id = :id")
                .param("at", A_WEEK_EARLIER.atOffset(ZoneOffset.UTC)).param("id", bookingId).update();
        return bookingId;
    }

    private List<String> addressesWrittenTo() {
        var captured = forClass(MimeMessage.class);
        verify(sender, atLeastOnce()).send(captured.capture());
        return captured.getAllValues().stream().map(BookingReminderTest::recipientOf).toList();
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
