package org.courtside.notification;

import jakarta.mail.BodyPart;
import jakarta.mail.Multipart;
import jakarta.mail.Part;
import jakarta.mail.internet.MimeMessage;
import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.CancellationReason;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.nio.charset.StandardCharsets;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentCaptor.forClass;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.atLeast;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.verify;

@TestPropertySource(properties = "courtside.public-url=https://courts.example.org")
@Import({FacilityTestFixture.class, IdentityTestFixture.class, BookingTestFixture.class})
class InstanceLinkMessageTest extends AbstractIntegrationTest {

    private static final String INSTANCE = "https://courts.example.org";
    private static final UUID MEMBER_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID TRAINING_CARD = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final TimeSlot SLOT = new TimeSlot(Instant.parse("2026-05-13T16:00:00Z"),
            Instant.parse("2026-05-13T17:00:00Z"));

    @MockitoSpyBean
    private JavaMailSender sender;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private BookingTestFixture bookings;

    @Autowired
    private JdbcClient jdbc;

    private UUID court;
    private UUID holderAccount;
    private UUID holderPerson;
    private UUID playerPerson;

    @BeforeEach
    void aClubWithAPublicAddress() {
        doNothing().when(sender).send(any(MimeMessage.class));
        court = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        holderPerson = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        holderAccount = identity.createEnabledAccount(holderPerson, "doe.jane", Set.of(Role.MEMBER));
        playerPerson = identity.createPerson("Richard", "Miles", "richard.miles@example.org");
        identity.createEnabledAccount(playerPerson, "miles.richard", Set.of(Role.MEMBER));
    }

    @Test
    void givenAPublicAddress_whenABookingIsConfirmed_thenTheMessageAndItsCalendarEntryLinkToTheBooking()
            throws Exception {
        // when
        UUID booking = book();

        // then
        String link = INSTANCE + "/my-bookings#booking-" + booking;
        MimeMessage confirmation = only(sentTo("jane.doe@example.org"));
        assertThat(text(confirmation)).as("the link stands on the last line of the confirmation")
                .endsWith("\n" + link);
        assertThat(calendar(confirmation).replace("\r\n ", ""))
                .as("the calendar entry carries the same link").contains("\r\nURL:" + link + "\r\n");
        assertThat(text(only(sentTo("richard.miles@example.org"))))
                .as("a recorded player is led to the same booking").endsWith("\n" + link);
    }

    @Test
    void givenAPublicAddress_whenTheClubCancelsABooking_thenTheMessageLinksToTheMembersBookings()
            throws Exception {
        // given
        UUID booking = book();
        UUID boardPerson = identity.createPerson("Mary", "Major", "mary.major@example.org");
        UUID board = identity.createEnabledAccount(boardPerson, "major.mary", Set.of(Role.ADMIN));

        // when
        bookings.cancelForTheClub(booking, board, CancellationReason.WEATHER);

        // then
        List<MimeMessage> toHolder = sentTo("jane.doe@example.org");
        assertThat(toHolder).as("a confirmation and the club's cancellation").hasSize(2);
        assertThat(text(toHolder.getLast())).as("#1244 sends every cancellation to the member's bookings")
                .endsWith("\n" + INSTANCE + "/my-bookings");
    }

    @Test
    void givenAPublicAddress_whenAQueuedCourtFrees_thenTheOfferLinksToWhereItIsTaken() throws Exception {
        // given
        UUID booking = book();
        UUID waitingPerson = identity.createPerson("John", "Roe", "john.roe@example.org");
        UUID waitingAccount = identity.createEnabledAccount(waitingPerson, "roe.john", Set.of(Role.MEMBER));
        UUID entry = bookings.joinWaitlist(court, MEMBER_CARD, SLOT, waitingAccount, waitingPerson, playerPerson);

        // when
        bookings.cancelBooking(booking, holderAccount, Set.of(Role.MEMBER));

        // then
        assertThat(text(only(sentTo("john.roe@example.org"))))
                .endsWith("\n" + INSTANCE + "/my-bookings#waitlist-" + entry);
    }

    @Test
    void givenAPublicAddress_whenABookingIsDue_thenTheReminderLinksToTheBooking() throws Exception {
        // given
        UUID booking = bookings.createBookingNamingMember(court, MEMBER_CARD, new TimeSlot(
                Instant.parse("2026-05-12T16:00:00Z"), Instant.parse("2026-05-12T17:00:00Z")), holderAccount,
                holderPerson, Set.of(Role.MEMBER), null, playerPerson);
        jdbc.sql("UPDATE booking SET created_at = :at WHERE id = :id")
                .param("at", OffsetDateTime.parse("2026-05-05T10:00:00Z")).param("id", booking).update();
        clearInvocations(sender);

        // when
        bookings.remindWhatIsDue();

        // then
        assertThat(text(only(sentTo("jane.doe@example.org"))))
                .endsWith("\n" + INSTANCE + "/my-bookings#booking-" + booking);
    }

    @Test
    void givenAPublicAddress_whenASeriesIsCreated_thenItsSummaryLinksToTheMembersBookingsWithoutAnOccurrence()
            throws Exception {
        // given
        UUID trainerPerson = identity.createPerson("Mary", "Major", "mary.major@example.org");
        UUID trainer = identity.createEnabledAccount(trainerPerson, "major.mary", Set.of(Role.TRAINER));

        // when
        bookings.createSeries(court, TRAINING_CARD, LocalDate.of(2026, 5, 19), LocalTime.of(18, 0), 120, 2,
                trainer, trainerPerson, Set.of(Role.TRAINER));

        // then
        assertThat(text(only(sentTo("mary.major@example.org"))))
                .as("a series has no single date to lead to, though its message names the first one")
                .endsWith("\n" + INSTANCE + "/my-bookings");
    }

    private UUID book() {
        return bookings.createBookingNamingMember(court, MEMBER_CARD, SLOT, holderAccount, holderPerson,
                Set.of(Role.MEMBER), null, playerPerson);
    }

    private List<MimeMessage> sentTo(String address) throws Exception {
        var captured = forClass(MimeMessage.class);
        verify(sender, atLeast(0)).send(captured.capture());
        return captured.getAllValues().stream()
                .filter(message -> address.equals(recipient(message)))
                .toList();
    }

    private static MimeMessage only(List<MimeMessage> messages) {
        assertThat(messages).as("exactly one message to this member").hasSize(1);
        return messages.getFirst();
    }

    private static String recipient(MimeMessage message) {
        try {
            return message.getAllRecipients()[0].toString();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static String text(Part part) throws Exception {
        if (part.getContent() instanceof Multipart multipart) {
            for (int index = 0; index < multipart.getCount(); index++) {
                String body = text(multipart.getBodyPart(index));
                if (body != null) {
                    return body;
                }
            }
            return null;
        }
        return part.getFileName() == null ? part.getContent().toString() : null;
    }

    private static String calendar(Part part) throws Exception {
        if (part.getContent() instanceof Multipart multipart) {
            for (int index = 0; index < multipart.getCount(); index++) {
                BodyPart child = multipart.getBodyPart(index);
                if ("booking.ics".equals(child.getFileName())) {
                    return new String(child.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
                }
                String nested = calendar(child);
                if (nested != null) {
                    return nested;
                }
            }
        }
        return null;
    }
}
