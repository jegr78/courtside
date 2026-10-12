package org.courtside.notification.internal;

import jakarta.mail.internet.MimeMessage;
import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.core.task.TaskExecutor;
import org.springframework.jdbc.core.simple.JdbcClient;
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

    private Map<String, Object> outcome() {
        return jdbc.sql("SELECT state, reason FROM message_record WHERE account_id = :account AND kind = 'WAITLIST_OFFER'")
                .param("account", waitingAccount).query().singleRow();
    }
}
