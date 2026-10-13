package org.courtside.notification;

import jakarta.mail.internet.MimeMessage;
import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.notification.testfixture.NotificationTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doNothing;

@Import({FacilityTestFixture.class, IdentityTestFixture.class, NotificationTestFixture.class, BookingTestFixture.class})
class PartnerPlaceMessageTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final TimeSlot SLOT = new TimeSlot(Instant.parse("2026-05-13T16:00:00Z"),
            Instant.parse("2026-05-13T17:00:00Z"));

    @MockitoSpyBean
    private JavaMailSender sender;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private NotificationTestFixture notifications;

    @Autowired
    private BookingTestFixture bookings;

    private SentMail mail;
    private UUID court;
    private UUID holderAccount;
    private UUID holderPerson;
    private UUID joinerAccount;
    private UUID joinerPerson;

    @BeforeEach
    void aHolderAndAMemberLookingForAGame() {
        doNothing().when(sender).send(any(MimeMessage.class));
        mail = new SentMail(sender);
        court = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        holderPerson = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        holderAccount = identity.createEnabledAccount(holderPerson, "doe.jane", Set.of(Role.MEMBER));
        joinerPerson = identity.createPerson("John", "Roe", "john.roe@example.org");
        joinerAccount = identity.createEnabledAccount(joinerPerson, "roe.john", Set.of(Role.MEMBER));
    }

    @Test
    void givenAPublishedPlace_whenAMemberTakesIt_thenTheHolderLearnsWhoAndTheMemberWhereTheyPlay() {
        // given
        UUID booking = bookings.createBookingLookingForAPartner(court, MEMBER_CARD, SLOT, holderAccount, holderPerson);
        UUID invitation = bookings.publishOpenPlace(booking, holderAccount);

        // when
        bookings.takeOpenPlace(invitation, joinerAccount, joinerPerson);

        // then
        assertThat(notifications.notificationsFor(holderAccount)).contains(MessageKind.BOOKING_PARTNER_FOUND);
        assertThat(notifications.notificationsFor(joinerAccount)).containsExactly(MessageKind.BOOKING_PLACE_TAKEN);
        assertThat(mail.bodiesTo("jane.doe@example.org")).filteredOn(String.class::isInstance)
                .as("the holder learns who took the place, as they would learn who left it")
                .anySatisfy(body -> assertThat(body).asString().contains("John Roe", "Mittwoch, 13. Mai 2026", "Court 1"));
        assertThat(mail.bodiesTo("john.roe@example.org")).singleElement().asString()
                .as("the member learns where they play and nothing about who booked")
                .contains("Mittwoch, 13. Mai 2026", "18:00", "19:00", "Court 1")
                .doesNotContain("Jane", "Doe");
    }

    @Test
    void givenAHolderWhoDeclinedTheMessage_whenAMemberTakesThePlace_thenOnlyTheMemberIsWrittenTo() {
        // given
        notifications.decline(holderAccount, MessageKind.BOOKING_PARTNER_FOUND);
        UUID booking = bookings.createBookingLookingForAPartner(court, MEMBER_CARD, SLOT, holderAccount, holderPerson);
        UUID invitation = bookings.publishOpenPlace(booking, holderAccount);

        // when
        bookings.takeOpenPlace(invitation, joinerAccount, joinerPerson);

        // then
        assertThat(notifications.notificationsFor(holderAccount)).doesNotContain(MessageKind.BOOKING_PARTNER_FOUND);
        assertThat(notifications.notificationsFor(joinerAccount)).containsExactly(MessageKind.BOOKING_PLACE_TAKEN);
    }

    @Test
    void givenAMemberWithTwoAccounts_whenTheyTakeAPlaceWithOne_thenThatOneIsConfirmed() {
        // given
        UUID person = identity.createPerson("Mary", "Major", "mary.major@example.org");
        UUID otherAccount = identity.createEnabledAccount(person, "major.mary", Set.of(Role.MEMBER));
        UUID takingAccount = identity.createEnabledAccount(person, "major.mary2", Set.of(Role.MEMBER));
        UUID booking = bookings.createBookingLookingForAPartner(court, MEMBER_CARD, SLOT, holderAccount, holderPerson);
        UUID invitation = bookings.publishOpenPlace(booking, holderAccount);

        // when
        bookings.takeOpenPlace(invitation, takingAccount, person);

        // then
        assertThat(notifications.notificationsFor(takingAccount)).as("the account that took the place is told where it plays")
                .containsExactly(MessageKind.BOOKING_PLACE_TAKEN);
        assertThat(notifications.notificationsFor(otherAccount)).isEmpty();
    }
}
