package org.courtside.notification.internal;

import jakarta.mail.Address;
import jakarta.mail.SendFailedException;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.courtside.shared.WaitlistAnnouncer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.core.task.TaskExecutor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mail.MailSendException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

@Import({FacilityTestFixture.class, IdentityTestFixture.class, BookingTestFixture.class})
class QueuedWaitlistOfferTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final TimeSlot SLOT = new TimeSlot(Instant.parse("2026-05-13T16:00:00Z"),
            Instant.parse("2026-05-13T17:00:00Z"));

    @MockitoSpyBean
    private JavaMailSender sender;

    @MockitoBean(name = "mailOutboxExecutor")
    private TaskExecutor executor;

    @Autowired
    private BookingTestFixture bookings;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MailOutbox outbox;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private WaitlistAnnouncer announcer;

    private UUID court;
    private UUID holderAccount;
    private UUID holderPerson;
    private UUID waitingAccount;
    private UUID waitingPerson;
    private UUID partnerPerson;

    @BeforeEach
    void aTakenCourtWithAWaitingMember() {
        doNothing().when(sender).send(any(MimeMessage.class));
        court = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        holderPerson = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        holderAccount = identity.createEnabledAccount(holderPerson, "doe.jane", Set.of(Role.MEMBER));
        waitingPerson = identity.createPerson("Mary", "Major", "mary.major@example.org");
        waitingAccount = identity.createEnabledAccount(waitingPerson, "major.mary", Set.of(Role.MEMBER));
        partnerPerson = identity.createPerson("Richard", "Miles", "richard.miles@example.org");
    }

    @Test
    void givenAnOfferDeclinedBeforeItsMailLeft_whenTheMailIsComposed_thenItFailsUnsentAsEnded() {
        // given
        UUID booking = bookings.createBookingNamingMember(court, MEMBER_CARD, SLOT, holderAccount, holderPerson,
                Set.of(Role.MEMBER), null, partnerPerson);
        UUID entry = bookings.joinWaitlist(court, MEMBER_CARD, SLOT, waitingAccount, waitingPerson, partnerPerson);
        bookings.cancelBooking(booking, holderAccount, Set.of(Role.MEMBER));
        bookings.leaveWaitlist(entry, waitingAccount);

        // when
        outbox.deliverDue();

        // then
        verify(sender, never()).send(any(MimeMessage.class));
        assertThat(outcome())
                .as("an offer that is no longer open is not mailed as one")
                .containsEntry("state", "FAILED").containsEntry("reason", "OfferEnded");
    }

    @Test
    void givenAnOpenOffer_whenTheMailIsComposed_thenItIsHandedOver() {
        // given
        UUID booking = bookings.createBookingNamingMember(court, MEMBER_CARD, SLOT, holderAccount, holderPerson,
                Set.of(Role.MEMBER), null, partnerPerson);
        bookings.joinWaitlist(court, MEMBER_CARD, SLOT, waitingAccount, waitingPerson, partnerPerson);
        bookings.cancelBooking(booking, holderAccount, Set.of(Role.MEMBER));

        // when
        outbox.deliverDue();

        // then
        assertThat(outcome()).containsEntry("state", "HANDED_OVER");
    }

    @Test
    void givenAnOpenOffer_whenTheRelayRefusesItsRecipient_thenTheOfferPassesToTheNextMember() throws Exception {
        // given
        UUID nextPerson = identity.createPerson("John", "Roe", "john.roe@example.org");
        UUID nextAccount = identity.createEnabledAccount(nextPerson, "roe.john", Set.of(Role.MEMBER));
        UUID booking = bookings.createBookingNamingMember(court, MEMBER_CARD, SLOT, holderAccount, holderPerson,
                Set.of(Role.MEMBER), null, partnerPerson);
        UUID entry = bookings.joinWaitlist(court, MEMBER_CARD, SLOT, waitingAccount, waitingPerson, partnerPerson);
        UUID next = bookings.joinWaitlist(court, MEMBER_CARD, SLOT, nextAccount, nextPerson, partnerPerson);
        bookings.cancelBooking(booking, holderAccount, Set.of(Role.MEMBER));
        doAnswer(invocation -> {
            MimeMessage sent = invocation.getArgument(0);
            if (sent.getAllRecipients()[0].toString().contains("mary.major")) {
                throw refusal();
            }
            return null;
        }).when(sender).send(any(MimeMessage.class));

        // when
        outbox.deliverDue();

        // then
        assertThat(outcome()).containsEntry("state", "REFUSED");
        assertThat(stateOf(entry)).as("an offer that cannot reach its member does not hold the court").isEqualTo("SKIPPED");
        assertThat(stateOf(next)).isEqualTo("OFFERED");
    }

    @Test
    void givenAnOfferTakenMeanwhile_whenItsMailIsReportedRefused_thenTheBookingStands() {
        // given
        UUID booking = bookings.createBookingNamingMember(court, MEMBER_CARD, SLOT, holderAccount, holderPerson,
                Set.of(Role.MEMBER), null, partnerPerson);
        UUID entry = bookings.joinWaitlist(court, MEMBER_CARD, SLOT, waitingAccount, waitingPerson, partnerPerson);
        bookings.cancelBooking(booking, holderAccount, Set.of(Role.MEMBER));
        bookings.acceptWaitlistOffer(entry, waitingAccount, waitingPerson);

        // when
        announcer.offerUndeliverable(entry);

        // then
        assertThat(stateOf(entry)).as("a refusal arriving after the offer ended changes nothing").isEqualTo("BOOKED");
    }

    private String stateOf(UUID entry) {
        return jdbc.sql("SELECT state FROM waitlist_entry WHERE id = :id").param("id", entry)
                .query(String.class).single();
    }

    private static MailSendException refusal() throws Exception {
        return new MailSendException(Map.of("<a-message-id@example.org>",
                new SendFailedException("550 5.1.1 user unknown", null, new Address[0],
                        new Address[0], new Address[]{new InternetAddress("mary.major@example.org")})));
    }

    private Map<String, Object> outcome() {
        return jdbc.sql("SELECT state, reason FROM message_record WHERE account_id = :account AND kind = 'WAITLIST_OFFER'")
                .param("account", waitingAccount).query().singleRow();
    }
}
