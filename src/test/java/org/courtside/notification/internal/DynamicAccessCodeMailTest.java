package org.courtside.notification.internal;

import jakarta.mail.internet.MimeMessage;
import org.courtside.AbstractIntegrationTest;
import org.courtside.access.testfixture.AccessTestFixture;
import org.courtside.booking.ParticipationService;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.card.testfixture.CardTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.annotation.Import;
import org.springframework.core.task.TaskExecutor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.sql.Timestamp;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
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

@ExtendWith(OutputCaptureExtension.class)
@TestPropertySource(properties = "courtside.access-control.connector=simulated")
@Import({FacilityTestFixture.class, IdentityTestFixture.class, CardTestFixture.class, BookingTestFixture.class,
        AccessTestFixture.class})
class DynamicAccessCodeMailTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID TRAINING_CARD = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final TimeSlot EVENING =
            new TimeSlot(Instant.parse("2026-05-12T16:00:00Z"), Instant.parse("2026-05-12T17:00:00Z"));
    private static final String FOLLOWS = "Zugangscode folgt";
    private static final String MISSING = "Zugangscode fehlt";

    @MockitoSpyBean
    private JavaMailSender sender;

    @MockitoBean(name = "mailOutboxExecutor")
    private TaskExecutor executor;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private CardTestFixture cards;

    @Autowired
    private BookingTestFixture bookings;

    @Autowired
    private AccessTestFixture access;

    @Autowired
    private ParticipationService participations;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private MailOutbox outbox;

    private UUID court;
    private UUID jane;
    private UUID janeAccount;
    private UUID john;

    @BeforeEach
    void aClubWhoseNorthGateTakesCodesFromTheAccessControlSystem() {
        doNothing().when(sender).send(any(MimeMessage.class));
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        court = facility.createCourt(1, "Court 1");
        facility.createAccessPointWithEmergencyCode("North gate", List.of(court), "975310");
        cards.letBookingsReceiveAccessCodes(MEMBER_BOOKING_CARD, true);
        jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        janeAccount = identity.createEnabledAccount(jane, "doe.jane", Set.of(Role.MEMBER, Role.TRAINER));
        john = identity.createPerson("John", "Roe", "john.roe@example.org");
        identity.createEnabledAccount(john, "roe.john", Set.of(Role.MEMBER));
    }

    @Test
    void givenAConnectedBooking_whenTheDoorAcceptsItsCodeBeforeTheConfirmationIsDue_thenOneMailCarriesTheCode() {
        // given
        UUID booking = book();

        // when
        String beforeTheWait = confirmationState();
        access.installDueGrants();
        String code = access.installedCodeOf(booking);
        letTheWaitPass();
        outbox.deliverDue();

        // then
        assertThat(beforeTheWait).as("the confirmation waits for the door instead of going out at once")
                .isEqualTo("QUEUED");
        assertThat(bodiesTo("jane.doe@example.org")).as("one confirmation, and it carries the code")
                .singleElement().satisfies(body -> assertThat(body).contains("North gate: " + code)
                        .doesNotContain(FOLLOWS));
        assertThat(kindsQueued()).as("no separate code mail follows").doesNotContain("ACCESS_CODE_READY");
    }

    @Test
    void givenAnOutage_whenTheConfirmationGoesOutFirst_thenItSaysTheCodeFollowsAndOneCodeMailCarriesItLater() {
        // given
        UUID booking = book();
        letTheWaitPass();
        outbox.deliverDue();
        List<String> confirmation = bodiesTo("jane.doe@example.org");
        clearInvocations(sender);

        // when
        access.installDueGrants();
        String code = access.installedCodeOf(booking);
        access.installDueGrants();
        outbox.deliverDue();

        // then
        assertThat(confirmation).singleElement().satisfies(body -> assertThat(body).contains(FOLLOWS)
                .doesNotContain("North gate:"));
        assertThat(kindsQueued().stream().filter("ACCESS_CODE_READY"::equals))
                .as("the booker who was told the code follows gets exactly one code mail").hasSize(1);
        assertThat(bodiesTo("jane.doe@example.org")).singleElement()
                .satisfies(body -> assertThat(body).contains("North gate: " + code));
        assertThat(bodiesTo("john.roe@example.org")).as("the player was promised nothing by mail").isEmpty();
    }

    @Test
    void givenACodeMailQueued_whenTheBookingStopsGrantingAccessBeforeItIsWritten_thenItIsDroppedUnsent() {
        // given
        book();
        letTheWaitPass();
        outbox.deliverDue();
        access.installDueGrants();
        clearInvocations(sender);
        cards.letBookingsReceiveAccessCodes(MEMBER_BOOKING_CARD, false);

        // when
        outbox.deliverDue();

        // then
        assertThat(bodiesTo("jane.doe@example.org")).as("a code nobody may use any more is not sent").isEmpty();
        assertThat(jdbc.sql("SELECT state, reason FROM message_record WHERE kind = 'ACCESS_CODE_READY'")
                .query().singleRow()).containsEntry("state", "FAILED").containsEntry("reason", "AccessWithdrawn");
    }

    @Test
    void givenAnInstalledGrant_whenTheReminderIsWritten_thenItCarriesTheCurrentCode() {
        // given
        UUID booking = book();
        access.installDueGrants();
        String code = access.installedCodeOf(booking);
        clearInvocations(sender);
        queue(booking, "BOOKING_REMINDER");

        // when
        outbox.deliverDue();

        // then
        assertThat(bodiesTo("john.roe@example.org")).as("the player learns the code from the reminder")
                .singleElement().satisfies(body -> assertThat(body).contains("North gate: " + code));
    }

    @Test
    void givenAReminderQueuedForAPlayerWhoLeft_whenItIsWritten_thenOnlyTheBookerStillGetsTheBookingsCode() {
        // given
        UUID booking = book();
        access.installDueGrants();
        String code = access.installedCodeOf(booking);
        queue(booking, "BOOKING_REMINDER");
        queue(booking, "BOOKING_REMINDER", janeAccount);
        participations.withdraw(booking, john, johnAccount());
        clearInvocations(sender);

        // when
        outbox.deliverDue();

        // then
        assertThat(bodiesTo("jane.doe@example.org")).as("the booker still needs the code")
                .anySatisfy(body -> assertThat(body).contains("North gate: " + code));
        assertThat(bodiesTo("john.roe@example.org")).as("another member's booking hands its code to nobody")
                .allSatisfy(body -> assertThat(body).doesNotContain(code).doesNotContain("Zugangscode"));
    }

    @Test
    void givenAGrantNotYetInstalled_whenTheReminderIsWritten_thenItSaysTheCodeIsMissingAndWhereToAsk() {
        // given
        UUID booking = book();
        queue(booking, "BOOKING_REMINDER");

        // when
        outbox.deliverDue();

        // then
        assertThat(bodiesTo("john.roe@example.org")).singleElement()
                .satisfies(body -> assertThat(body).contains(MISSING).contains("Meine Buchungen")
                        .doesNotContain("975310"));
    }

    @Test
    void givenAnInstalledGrant_whenTheClubMovesTheSeriesOnlyDate_thenTheMoveMailCarriesTheSameCode() {
        // given
        UUID board = identity.createEnabledAccount(identity.createPerson("Mary", "Major", "mary.major@example.org"),
                "major.mary", Set.of(Role.ADMIN));
        cards.letBookingsReceiveAccessCodes(TRAINING_CARD, true);
        UUID series = bookings.createSeries(court, TRAINING_CARD, LocalDate.of(2026, 5, 12),
                LocalTime.of(18, 0), 60, 1, janeAccount, jane, Set.of(Role.TRAINER));
        UUID booking = bookings.firstOccurrenceOf(series);
        access.installDueGrants();
        String code = access.installedCodeOf(booking);
        outbox.deliverDue();
        clearInvocations(sender);

        // when
        bookings.moveWholeSeries(series, LocalTime.of(19, 0), board, Set.of(Role.ADMIN));
        access.installDueGrants();
        outbox.deliverDue();

        // then
        assertThat(access.installedCodeOf(booking)).as("a move keeps the code").isEqualTo(code);
        assertThat(bodiesTo("jane.doe@example.org")).singleElement()
                .satisfies(body -> assertThat(body).contains("North gate: " + code).contains("18:45"));
    }

    @Test
    void givenTheWholeFlow_whenTheCodeIsMailed_thenItIsInNoAuditRowMessageParameterOrLogLine(CapturedOutput log) {
        // given
        UUID booking = book();
        letTheWaitPass();
        outbox.deliverDue();

        // when
        access.installDueGrants();
        String code = access.installedCodeOf(booking);
        queue(booking, "BOOKING_REMINDER");
        List<String> parametersWhileQueued = jdbc.sql("SELECT parameters::text FROM message_record")
                .query(String.class).list();
        outbox.deliverDue();

        // then
        assertThat(bodiesTo("jane.doe@example.org")).as("the code did travel by mail")
                .anySatisfy(body -> assertThat(body).contains(code));
        assertThat(jdbc.sql("SELECT payload::text FROM domain_event").query(String.class).list())
                .noneMatch(payload -> payload.contains(code));
        assertThat(parametersWhileQueued).noneMatch(parameters -> parameters.contains(code));
        assertThat(log.getAll()).as("no log line names the code").doesNotContain(code);
    }

    private UUID book() {
        UUID booking = bookings.createBookingNamingMember(court, MEMBER_BOOKING_CARD, EVENING, janeAccount, jane,
                Set.of(Role.MEMBER), null, john);
        outbox.deliverDue();
        clearInvocations(sender);
        return booking;
    }

    private String confirmationState() {
        return jdbc.sql("SELECT state FROM message_record WHERE kind = 'BOOKING_CONFIRMED'").query(String.class)
                .single();
    }

    private void letTheWaitPass() {
        jdbc.sql("UPDATE message_record SET next_attempt_at = queued_at WHERE state = 'QUEUED'").update();
    }

    private List<String> kindsQueued() {
        return jdbc.sql("SELECT kind FROM message_record").query(String.class).list();
    }

    private UUID johnAccount() {
        return jdbc.sql("SELECT id FROM user_account WHERE person_id = ?").params(john).query(UUID.class).single();
    }

    private void queue(UUID booking, String kind) {
        queue(booking, kind, johnAccount());
    }

    private void queue(UUID booking, String kind, UUID accountId) {
        jdbc.sql("""
                        INSERT INTO message_record (id, account_id, kind, state, message_id, queued_at,
                                                    next_attempt_at, parameters)
                        VALUES (:id, :accountId, :kind, 'QUEUED', :messageId, :at, :at, CAST(:parameters AS jsonb))
                        """)
                .param("id", UUID.randomUUID()).param("accountId", accountId).param("kind", kind)
                .param("messageId", "<" + UUID.randomUUID() + "@example.org>")
                .param("at", Timestamp.from(Instant.parse("2026-05-12T10:00:00Z")))
                .param("parameters", "{\"bookingId\": \"" + booking + "\"}")
                .update();
    }

    private List<String> bodiesTo(String address) {
        var captured = forClass(MimeMessage.class);
        verify(sender, atLeast(0)).send(captured.capture());
        List<String> bodies = new ArrayList<>();
        for (MimeMessage message : captured.getAllValues()) {
            try {
                if (address.equals(message.getAllRecipients()[0].toString())) {
                    bodies.add(MailBodies.textOf(message.getContent()));
                }
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        }
        return bodies;
    }
}
