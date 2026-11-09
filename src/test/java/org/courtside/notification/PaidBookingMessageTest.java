package org.courtside.notification;

import jakarta.mail.Multipart;
import jakarta.mail.Part;
import jakarta.mail.internet.MimeMessage;
import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.booking.PendingPayments;
import org.courtside.card.testfixture.CardTestFixture;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.credit.BookingPayments;
import org.courtside.credit.testfixture.CreditTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.payment.testfixture.PaymentTestFixture;
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
import org.springframework.transaction.support.TransactionTemplate;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.util.Currency;
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
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

@TestPropertySource(properties = "courtside.public-url=https://courts.example.org")
@Import({FacilityTestFixture.class, IdentityTestFixture.class, CardTestFixture.class, ConfigTestFixture.class,
        CreditTestFixture.class, PaymentTestFixture.class})
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
    @Autowired
    private PaymentTestFixture payment;
    @Autowired
    private PendingPayments pendingPayments;
    @Autowired
    private BookingPayments bookingPayments;
    @Autowired
    private TransactionTemplate transactions;
    @Autowired
    private JdbcClient jdbc;

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

    @Test
    void givenABookingWithAnAmountButNoDebit_whenTheClubCancelsIt_thenTheMailPromisesNoRefund() throws Exception {
        // given
        cards.priceForExternals(winterDoubles, 0);
        UUID booking = book();
        jdbc.sql("UPDATE booking SET amount_minor = 1500 WHERE id = :id").param("id", booking).update();
        firstMailTo("john.roe@example.org");
        clearInvocations(sender);

        // when
        bookings.cancel(booking, adminAccount, Set.of(Role.ADMIN));

        // then
        assertThat(textOf(firstMailTo("john.roe@example.org")))
                .as("a booking made before payments existed was never debited, so nothing returns")
                .doesNotContain("Guthaben");
    }

    @Test
    void givenABookingAwaitingPayPal_whenThePaymentIsConfirmed_thenTheConfirmationSaysItWasPaidByPayPal()
            throws Exception {
        // given
        UUID booking = bookPending();

        // when
        transactions.executeWithoutResult(status -> {
            bookingPayments.payByPayPal(johnAccount, booking, "ORDER-1", 1500, Currency.getInstance("EUR"));
            pendingPayments.confirm(booking);
        });

        // then
        assertThat(textOf(firstMailTo("john.roe@example.org")))
                .contains("Per PayPal bezahlt: 15,00 €")
                .doesNotContain("Bezahlt aus deinem Guthaben");
    }

    @Test
    void givenABookingAwaitingPayPal_whenItsHoldEnds_thenTheBookerGetsNoMailForIt() {
        // given
        UUID booking = bookPending();

        // when
        pendingPayments.release(booking);

        // then
        await().during(Duration.ofSeconds(2)).atMost(Duration.ofSeconds(3)).untilAsserted(() ->
                verify(sender, never()).send(any(MimeMessage.class)));
    }

    private UUID bookPending() {
        payment.storePayPal(true);
        credit.payOut(johnAccount, 1000);
        UUID booking = book();
        assertThat(pendingPayments.pending(booking)).as("short credit with PayPal on holds the court").isPresent();
        return booking;
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
