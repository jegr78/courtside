package org.courtside.notification;

import jakarta.mail.Multipart;
import jakarta.mail.Part;
import jakarta.mail.internet.MimeMessage;
import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.card.testfixture.CardTestFixture;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.credit.testfixture.CreditTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.mockito.ArgumentCaptor.forClass;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.atLeast;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.verify;

@Import({FacilityTestFixture.class, IdentityTestFixture.class, CardTestFixture.class, ConfigTestFixture.class,
        CreditTestFixture.class})
class PaidBookingMessageTest extends AbstractIntegrationTest {

    private static final TimeSlot SIX_TO_SEVEN =
            new TimeSlot(Instant.parse("2026-05-13T16:00:00Z"), Instant.parse("2026-05-13T17:00:00Z"));

    @MockitoSpyBean
    private JavaMailSender sender;

    @Autowired
    private BookingService bookings;
    @Autowired
    private FacilityTestFixture facility;
    @Autowired
    private IdentityTestFixture identity;
    @Autowired
    private CardTestFixture cards;
    @Autowired
    private ConfigTestFixture config;
    @Autowired
    private CreditTestFixture credit;

    private UUID courtId;
    private UUID winterDoubles;
    private UUID johnPerson;
    private UUID johnAccount;
    private UUID adminAccount;

    @BeforeEach
    void setUp() {
        doNothing().when(sender).send(any(MimeMessage.class));
        courtId = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        config.admitExternalBookings(true);
        winterDoubles = cards.createDoublesCardForGuestsAllowing("Winter doubles",
                Set.of(Role.EXTERNAL, Role.MEMBER));
        cards.priceForExternals(winterDoubles, 1500);
        johnPerson = identity.createPerson("John", "Roe", "john.roe@example.org");
        johnAccount = identity.createEnabledAccount(johnPerson, "roe.john", Set.of(Role.EXTERNAL));
        adminAccount = identity.createEnabledAccount(identity.createPerson("Mary", "Major", "mary.major@example.org"),
                "major.mary", Set.of(Role.ADMIN));
        credit.credit(johnAccount, 1500);
    }

    @Test
    void givenABookingPaidFromCredit_whenTheConfirmationIsRead_thenItStatesTheAmountAndHowItWasPaid()
            throws Exception {
        // when
        book();

        // then
        assertThat(textOf(firstMailTo("john.roe@example.org")))
                .contains("Bezahlt aus deinem Guthaben: 15,00 €");
    }

    @Test
    void givenAPaidBooking_whenTheClubCancelsIt_thenTheBookerReadsOfTheRefund() throws Exception {
        // given
        UUID booking = book();
        firstMailTo("john.roe@example.org");
        clearInvocations(sender);

        // when
        bookings.cancel(booking, adminAccount, Set.of(Role.ADMIN));

        // then
        assertThat(textOf(firstMailTo("john.roe@example.org")))
                .contains("15,00 € sind wieder auf deinem Guthaben.");
    }

    private UUID book() {
        return bookings.create(new CreateBookingCommand(List.of(courtId), winterDoubles, SIX_TO_SEVEN, johnAccount,
                johnPerson, Set.of(Role.EXTERNAL), null, List.of(ParticipantSpec.guest("Richard Miles")), null));
    }

    private MimeMessage firstMailTo(String address) {
        return await().atMost(Duration.ofSeconds(10)).until(() -> sentTo(address), Objects::nonNull);
    }

    private MimeMessage sentTo(String address) throws Exception {
        var captured = forClass(MimeMessage.class);
        verify(sender, atLeast(0)).send(captured.capture());
        for (MimeMessage message : captured.getAllValues()) {
            if (address.equals(message.getAllRecipients()[0].toString())) {
                String messageId = message.getHeader("Message-ID")[0];
                message.saveChanges();
                message.setHeader("Message-ID", messageId);
                return message;
            }
        }
        return null;
    }

    private static String textOf(Part part) throws Exception {
        if (part.isMimeType("text/plain") && part.getFileName() == null) {
            return part.getContent().toString();
        }
        if (part.getContent() instanceof Multipart multipart) {
            for (int index = 0; index < multipart.getCount(); index++) {
                String body = textOf(multipart.getBodyPart(index));
                if (body != null) {
                    return body;
                }
            }
        }
        return null;
    }
}
