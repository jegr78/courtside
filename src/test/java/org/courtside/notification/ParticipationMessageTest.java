package org.courtside.notification;

import jakarta.mail.internet.MimeMessage;
import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.booking.ParticipationService;
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
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

@Import({FacilityTestFixture.class, IdentityTestFixture.class})
class ParticipationMessageTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");

    private static final Instant SIX_PM = Instant.parse("2026-05-13T16:00:00Z");
    private static final Instant SEVEN_PM = Instant.parse("2026-05-13T17:00:00Z");

    @MockitoSpyBean
    private JavaMailSender sender;

    @Autowired
    private BookingService bookings;

    @Autowired
    private ParticipationService participations;

    @Autowired
    private FacilityTestFixture facility;

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
    void aClubWithACourtAMemberAndACoPlayer() {
        doNothing().when(sender).send(any(MimeMessage.class));
        courtId = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        bookerPersonId = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        bookerAccountId = identity.createEnabledAccount(bookerPersonId, "doe.jane", Set.of(Role.MEMBER));
        playerPersonId = identity.createPerson("John", "Roe", "john.roe@example.org");
        playerAccountId = identity.createEnabledAccount(playerPersonId, "roe.john", Set.of(Role.MEMBER));
    }

    @Test
    void givenAMemberRecordedAsAPlayer_whenTheBookingIsWritten_thenTheyAreToldWithoutBeingAsked()
            throws Exception {
        // when
        book(playerPersonId);

        // then — two messages leave: the booker's confirmation and the co-player's notice
        assertThat(addressesWrittenTo()).contains("john.roe@example.org");
        assertThat(recordedKinds()).contains("BOOKING_PLAYER_RECORDED");
    }

    @Test
    void givenTheNoticeAboutBeingRecorded_whenItIsRead_thenItNamesTheBookingAndNotWhoMadeIt()
            throws Exception {
        // when
        book(playerPersonId);

        // then — the participation list names nobody either, so neither may this
        String notice = lastBodyTo("john.roe@example.org");
        assertThat(notice).contains("13. Mai 2026", "18:00", "19:00", "Court 1");
        assertThat(notice).doesNotContain("Jane").doesNotContain("Doe");
    }

    @Test
    void givenOnlyAGuestAndNoMember_whenTheBookingIsWritten_thenOnlyTheBookerIsWrittenTo()
            throws Exception {
        // when
        bookings.create(new CreateBookingCommand(List.of(courtId), MEMBER_BOOKING_CARD,
                new TimeSlot(SIX_PM, SEVEN_PM), bookerAccountId, bookerPersonId, Set.of(Role.MEMBER),
                null, List.of(ParticipantSpec.guest("Mary Major")), null));

        // then
        verify(sender, times(1)).send(any(MimeMessage.class));
        assertThat(addressesWrittenTo()).containsExactly("jane.doe@example.org");
    }

    @Test
    void givenAMemberWhoHoldsNoAccount_whenTheyAreRecorded_thenTheBookingStandsAndNothingIsSent()
            throws Exception {
        // given
        UUID accountless = identity.createPerson("Mary", "Major", "mary.major@example.org");

        // when
        book(accountless);

        // then — the log names accounts, so a member without one is not written to
        assertThat(addressesWrittenTo()).containsExactly("jane.doe@example.org");
        assertThat(jdbc.sql("SELECT count(*) FROM booking").query(Long.class).single()).isEqualTo(1L);
    }

    @Test
    void givenAMemberSomebodyElseRecorded_whenTheyTakeThemselvesOut_thenTheBookerIsTold()
            throws Exception {
        // given
        UUID bookingId = book(playerPersonId);

        // when
        participations.withdraw(bookingId, playerPersonId, playerAccountId);

        // then — the booker chose the name, so naming it tells them nothing new
        assertThat(lastBodyTo("jane.doe@example.org")).contains("John Roe");
        assertThat(recordedKinds()).contains("BOOKING_PLAYER_WITHDREW");
    }

    @Test
    void whenAMemberTakesThemselvesOut_thenTheyAreNotWrittenToAboutTheirOwnObjection()
            throws Exception {
        // given
        UUID bookingId = book(playerPersonId);
        int before = addressesWrittenTo().stream().filter("john.roe@example.org"::equals).toList().size();

        // when
        participations.withdraw(bookingId, playerPersonId, playerAccountId);

        // then
        assertThat(addressesWrittenTo().stream().filter("john.roe@example.org"::equals).toList())
                .hasSize(before);
    }

    @Test
    void whenBothMessagesHaveGoneOut_thenNothingTheyLeaveBehindNamesAnybody() throws Exception {
        // given
        UUID bookingId = book(playerPersonId);

        // when
        participations.withdraw(bookingId, playerPersonId, playerAccountId);

        // then — every column and every payload, so a new one cannot quietly hold a name
        assertThat(jdbc.sql("SELECT * FROM message_record").query().listOfRows())
                .isNotEmpty()
                .allSatisfy(row -> assertThat(row.values())
                        .filteredOn(value -> value != null)
                        .noneMatch(value -> namesAnybody(String.valueOf(value))));
        assertThat(jdbc.sql("SELECT payload FROM domain_event WHERE event_type LIKE 'booking.%'")
                .query(String.class).list())
                .isNotEmpty()
                .noneMatch(ParticipationMessageTest::namesAnybody);
    }

    private static boolean namesAnybody(String text) {
        return text.contains("john.roe@example.org") || text.contains("jane.doe@example.org")
                || text.contains("John") || text.contains("Roe")
                || text.contains("Jane") || text.contains("Doe");
    }

    private UUID book(UUID coPlayerPersonId) {
        return bookings.create(new CreateBookingCommand(List.of(courtId), MEMBER_BOOKING_CARD,
                new TimeSlot(SIX_PM, SEVEN_PM), bookerAccountId, bookerPersonId, Set.of(Role.MEMBER),
                null, List.of(ParticipantSpec.member(coPlayerPersonId)), null));
    }

    private List<String> addressesWrittenTo() throws Exception {
        var captured = forClass(MimeMessage.class);
        verify(sender, org.mockito.Mockito.atLeastOnce()).send(captured.capture());
        return captured.getAllValues().stream()
                .map(ParticipationMessageTest::recipientOf)
                .toList();
    }

    // The last one, because a booker is written to twice: the confirmation, then this.
    private String lastBodyTo(String address) throws Exception {
        var captured = forClass(MimeMessage.class);
        verify(sender, org.mockito.Mockito.atLeastOnce()).send(captured.capture());
        return captured.getAllValues().stream()
                .filter(message -> address.equals(recipientOf(message)))
                .reduce((earlier, later) -> later)
                .orElseThrow(() -> new AssertionError("Nothing reached " + address))
                .getContent().toString();
    }

    private List<String> recordedKinds() {
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
