package org.courtside.notification;

import jakarta.mail.internet.MimeMessage;
import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.card.testfixture.CardTestFixture;
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
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentCaptor.forClass;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.verify;

@Import({FacilityTestFixture.class, IdentityTestFixture.class, BookingTestFixture.class, CardTestFixture.class})
class AccessCodeMessageTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID TRAINING_CARD = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final TimeSlot EVENING =
            new TimeSlot(Instant.parse("2026-05-12T16:00:00Z"), Instant.parse("2026-05-12T17:00:00Z"));
    private static final String OLD_CODE = "135790";
    private static final String NEW_CODE = "975310";

    @MockitoSpyBean
    private JavaMailSender sender;

    @Autowired
    private BookingService bookings;

    @Autowired
    private BookingTestFixture bookingFixture;

    @Autowired
    private FacilityService facilityService;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private CardTestFixture cards;

    @Autowired
    private JdbcClient jdbc;

    private List<UUID> courts;
    private UUID northGate;
    private UUID jane;
    private UUID janeAccount;
    private UUID john;
    private UUID johnAccount;

    @BeforeEach
    void aClubWhoseNorthGateLeadsToTheFirstTwoCourts() {
        doNothing().when(sender).send(any(MimeMessage.class));
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        courts = List.of(facility.createCourt(1, "Court 1"), facility.createCourt(2, "Court 2"),
                facility.createCourt(3, "Court 3"));
        northGate = facility.createAccessPoint("North gate", courts.subList(0, 2), OLD_CODE);
        cards.letBookingsReceiveAccessCodes(MEMBER_BOOKING_CARD, true);
        jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        janeAccount = identity.createEnabledAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        john = identity.createPerson("John", "Roe", "john.roe@example.org");
        johnAccount = identity.createEnabledAccount(john, "roe.john", Set.of(Role.MEMBER));
    }

    @Test
    void givenABookingBehindTheNorthGate_whenItIsConfirmed_thenTheConfirmationCarriesTheCodeAndItsWindow()
            throws Exception {
        // when
        bookOnCourtTwo(janeAccount, jane, john);

        // then
        assertThat(lastBodyTo("jane.doe@example.org"))
                .contains("Zugangscode, gültig von 17:45 bis 19:15:\nNorth gate: " + OLD_CODE);
    }

    @Test
    void givenABookingBehindTheNorthGate_whenItsReminderGoesOut_thenThePlayerIsGivenTheCodeToo() throws Exception {
        // given
        UUID booking = bookOnCourtTwo(janeAccount, jane, john);
        jdbc.sql("UPDATE booking SET created_at = :at WHERE id = :id")
                .param("at", Instant.parse("2026-05-05T10:00:00Z").atOffset(ZoneOffset.UTC)).param("id", booking)
                .update();
        clearInvocations(sender);

        // when
        bookingFixture.remindWhatIsDue();

        // then
        assertThat(lastBodyTo("john.roe@example.org")).contains("North gate: " + OLD_CODE);
    }

    @Test
    void givenBookingsAroundTheNorthGate_whenItsCodeChanges_thenOnlyTheUpcomingGrantingOnesBookerIsToldOnce()
            throws Exception {
        // given
        UUID affected = bookOnCourtTwo(janeAccount, jane, john);
        UUID otherCourt = bookings.create(new CreateBookingCommand(List.of(courts.get(2)), MEMBER_BOOKING_CARD,
                EVENING, johnAccount, john, Set.of(Role.MEMBER), null, List.of(ParticipantSpec.member(jane)), null));
        UUID richard = identity.createPerson("Richard", "Miles", "richard.miles@example.org");
        UUID richardAccount = identity.createEnabledAccount(richard, "miles.richard", Set.of(Role.MEMBER));
        UUID cancelled = bookings.create(new CreateBookingCommand(List.of(courts.getFirst()), MEMBER_BOOKING_CARD,
                EVENING, richardAccount, richard, Set.of(Role.MEMBER), null, List.of(ParticipantSpec.guest("Guest")),
                null));
        bookingFixture.cancelBooking(cancelled, richardAccount, Set.of(Role.MEMBER));
        UUID past = bookingFixture.insertBookingThatHasStarted(courts.getFirst(), MEMBER_BOOKING_CARD,
                new TimeSlot(Instant.parse("2026-05-12T07:00:00Z"), Instant.parse("2026-05-12T08:00:00Z")), richardAccount);
        UUID withoutAccess = cards.createBookingCard("Club evening", Set.of(), Set.of(), new short[]{});
        UUID notGranting = bookings.create(new CreateBookingCommand(List.of(courts.get(1)), withoutAccess,
                new TimeSlot(Instant.parse("2026-05-12T18:00:00Z"), Instant.parse("2026-05-12T19:00:00Z")),
                richardAccount, richard, Set.of(Role.MEMBER), null, List.of(), null));
        clearInvocations(sender);

        // when
        facilityService.changeAccessPoint(northGate, "North gate", courts.subList(0, 2), NEW_CODE);

        // then
        List<Map<String, Object>> told = jdbc.sql("""
                        SELECT account_id, parameters::text AS parameters FROM notification
                        WHERE kind = 'ACCESS_CODE_CHANGED'
                        """).query().listOfRows();
        assertThat(told).as("one message, to the booker of the one upcoming granting booking on the gate's courts")
                .hasSize(1);
        assertThat(told.getFirst().get("account_id")).isEqualTo(janeAccount);
        assertThat(told.getFirst().get("parameters").toString()).contains(affected.toString())
                .doesNotContain(otherCourt.toString(), cancelled.toString(), past.toString(), notGranting.toString());
        assertThat(jdbc.sql("""
                        SELECT subject_id FROM domain_event WHERE event_type = 'booking.booking.accessCodeChanged'
                        """).query(UUID.class).list())
                .as("only the upcoming booking on the gate's courts whose card grants access is announced")
                .containsExactly(affected);
        assertThat(lastBodyTo("jane.doe@example.org")).as("the message carries the code the gate takes now")
                .contains("North gate: " + NEW_CODE).doesNotContain(OLD_CODE);
    }

    @Test
    void givenASeriesBehindTheNorthGate_whenItsCodeChanges_thenOnlyTheOccurrenceAlreadyRemindedIsAnnounced() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        UUID maryAccount = identity.createEnabledAccount(mary, "major.mary", Set.of(Role.ADMIN));
        cards.letBookingsReceiveAccessCodes(TRAINING_CARD, true);
        UUID series = bookingFixture.createSeries(courts.getFirst(), TRAINING_CARD, LocalDate.of(2026, 5, 14),
                LocalTime.of(18, 0), 60, 4, maryAccount, mary, Set.of(Role.ADMIN));
        UUID reminded = bookingFixture.firstOccurrenceOf(series);
        jdbc.sql("UPDATE booking SET reminded_at = :at WHERE id = :id")
                .param("at", Instant.parse("2026-05-12T09:00:00Z").atOffset(ZoneOffset.UTC)).param("id", reminded)
                .update();

        // when
        facilityService.changeAccessPoint(northGate, "North gate", courts.subList(0, 2), NEW_CODE);

        // then
        assertThat(jdbc.sql("SELECT count(*) FROM notification WHERE kind = 'ACCESS_CODE_CHANGED'")
                .query(Long.class).single())
                .as("an occurrence learns its code from its reminder, so only the one already reminded is told")
                .isEqualTo(1L);
        assertThat(jdbc.sql("""
                        SELECT subject_id FROM domain_event WHERE event_type = 'booking.booking.accessCodeChanged'
                        """).query(UUID.class).list()).containsExactly(reminded);
    }

    @Test
    void givenAnAccessPointWhoseCodeIsRemoved_whenSaved_thenNobodyIsToldOfACode() {
        // given
        bookOnCourtTwo(janeAccount, jane, john);

        // when
        facilityService.changeAccessPoint(northGate, "North gate", courts.subList(0, 2), null);

        // then
        assertThat(jdbc.sql("SELECT count(*) FROM domain_event WHERE event_type = 'facility.accessPoint.codeChanged'")
                .query(Long.class).single()).as("a removed code is no new code to announce").isZero();
        assertThat(jdbc.sql("SELECT count(*) FROM message_record WHERE kind = 'ACCESS_CODE_CHANGED'")
                .query(Long.class).single()).isZero();
    }

    private UUID bookOnCourtTwo(UUID bookerAccount, UUID booker, UUID player) {
        return bookings.create(new CreateBookingCommand(List.of(courts.get(1)), MEMBER_BOOKING_CARD, EVENING,
                bookerAccount, booker, Set.of(Role.MEMBER), null, List.of(ParticipantSpec.member(player)), null));
    }

    private String lastBodyTo(String address) throws Exception {
        var captured = forClass(MimeMessage.class);
        verify(sender, atLeastOnce()).send(captured.capture());
        MimeMessage last = captured.getAllValues().stream()
                .filter(message -> address.equals(recipientOf(message)))
                .reduce((earlier, later) -> later)
                .orElseThrow(() -> new AssertionError("Nothing reached " + address));
        return textOf(last.getContent());
    }

    private static String textOf(Object content) throws Exception {
        if (content instanceof jakarta.mail.Multipart multipart) {
            return textOf(multipart.getBodyPart(0).getContent());
        }
        return content.toString();
    }

    private static String recipientOf(MimeMessage message) {
        try {
            return message.getAllRecipients()[0].toString();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
