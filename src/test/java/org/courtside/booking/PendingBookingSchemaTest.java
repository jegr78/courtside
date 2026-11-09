package org.courtside.booking;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.CancellationReason;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Import(IdentityTestFixture.class)
class PendingBookingSchemaTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final Instant SIX_PM = Instant.parse("2026-05-12T16:00:00Z");
    private static final Instant SEVEN_PM = Instant.parse("2026-05-12T17:00:00Z");
    private static final Instant EXPIRY = Instant.parse("2026-05-12T10:15:00Z");

    @Autowired
    private JdbcClient jdbc;
    @Autowired
    private IdentityTestFixture identity;

    private UUID court;

    @BeforeEach
    void setUp() {
        court = UUID.randomUUID();
        jdbc.sql("INSERT INTO court (id, number, active) VALUES (?, 1, true)").params(court).update();
    }

    @Test
    void givenAPendingBooking_whenAnotherBookingTakesTheCourt_thenTheExclusionRefusesIt() {
        // given
        UUID pending = insertBooking("PENDING_PAYMENT", UUID.randomUUID(), EXPIRY);
        insertAllocation(pending, "PENDING_PAYMENT");
        UUID second = insertBooking("CONFIRMED", UUID.randomUUID(), null);

        // when / then
        assertThatThrownBy(() -> insertAllocation(second, "CONFIRMED"))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("court_allocation_no_overlap");
    }

    @Test
    void givenAPendingBookingOfAnAccount_whenASecondIsInserted_thenTheUniqueIndexRefusesIt() {
        // given
        UUID account = UUID.randomUUID();
        insertBooking("PENDING_PAYMENT", account, EXPIRY);

        // when / then
        assertThatThrownBy(() -> insertBooking("PENDING_PAYMENT", account, EXPIRY))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("booking_one_pending_per_account");
    }

    @Test
    void givenAPendingStatus_whenNoExpiryIsSet_thenTheCheckRefusesIt() {
        // when / then
        assertThatThrownBy(() -> insertBooking("PENDING_PAYMENT", UUID.randomUUID(), null))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("booking_pending_has_expiry");
    }

    @Test
    void givenAPayPalLedgerKind_whenNoOrderIdIsSet_thenTheCheckRefusesIt() {
        // given
        UUID account = identity.createEnabledAccount(identity.createPerson("Jane", "Doe"), "jane.doe",
                Set.of(Role.EXTERNAL));
        jdbc.sql("INSERT INTO credit_account (account_id) VALUES (?)").param(account).update();

        // when / then
        assertThatThrownBy(() -> jdbc.sql("""
                        INSERT INTO credit_entry (id, account_id, kind, amount_minor, currency, recorded_at, booking_id)
                        VALUES (?, ?, 'PAYPAL_PAYMENT', 1500, 'EUR', now(), ?)
                        """)
                .params(UUID.randomUUID(), account, UUID.randomUUID())
                .update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("credit_entry_paypal_order_reference");
    }

    @ParameterizedTest
    @CsvSource(value = {"CAPTURED,", "LATE_CAPTURED,", "CREATED,CAPTURE1", "REJECTED,CAPTURE1", "VOIDED,CAPTURE1"})
    void givenAPayPalOrderStatus_whenItsCaptureIdDisagrees_thenTheCheckRefusesIt(String status, String captureId) {
        // when / then
        assertThatThrownBy(() -> jdbc.sql("""
                        INSERT INTO paypal_order (order_id, booking_id, account_id, environment, amount_minor, currency,
                                                  status, capture_id, approve_url, created_at, updated_at)
                        VALUES ('ORDER1', ?, ?, 'SANDBOX', 1500, 'EUR', ?, ?, 'https://www.sandbox.paypal.com/x',
                                now(), now())
                        """)
                .params(UUID.randomUUID(), UUID.randomUUID(), status, captureId)
                .update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("paypal_order_capture_id");
    }

    @Test
    void givenAPendingBooking_whenConfirmed_thenBookingAndAllocationsAreConfirmed() {
        // given
        Booking booking = new Booking(MEMBER_BOOKING_CARD, UUID.randomUUID(), null, EXPIRY);
        booking.allocate(court, new TimeSlot(SIX_PM, SEVEN_PM));
        booking.awaitPayment(EXPIRY);

        // when
        boolean first = booking.confirmPayment();
        boolean second = booking.confirmPayment();

        // then
        assertThat(first).as("first confirmation").isTrue();
        assertThat(second).as("second confirmation").isFalse();
        assertThat(booking.getStatus()).isEqualTo(BookingStatus.CONFIRMED);
        assertThat(booking.getAllocations()).extracting(CourtAllocation::getStatus)
                .containsOnly(BookingStatus.CONFIRMED);
        assertThat(booking.paymentExpiresAt()).as("expiry stays").contains(EXPIRY);
    }

    @Test
    void givenAPendingBooking_whenExpired_thenItIsCancelledWithPaymentExpired() {
        // given
        UUID by = UUID.randomUUID();
        Booking booking = new Booking(MEMBER_BOOKING_CARD, UUID.randomUUID(), null, EXPIRY);
        booking.allocate(court, new TimeSlot(SIX_PM, SEVEN_PM));
        booking.awaitPayment(EXPIRY);

        // when
        boolean expired = booking.expirePayment(EXPIRY, by);

        // then
        assertThat(expired).isTrue();
        assertThat(booking.getStatus()).isEqualTo(BookingStatus.CANCELLED);
        assertThat(booking.getCancellationReason()).isEqualTo(CancellationReason.PAYMENT_EXPIRED);
        assertThat(booking.getCancelledBy()).isEqualTo(by);
        assertThat(booking.getAllocations()).extracting(CourtAllocation::getStatus)
                .containsOnly(BookingStatus.CANCELLED);
    }

    @Test
    void givenAConfirmedBooking_whenPaymentIsConfirmedOrExpired_thenNothingChanges() {
        // given
        Booking booking = new Booking(MEMBER_BOOKING_CARD, UUID.randomUUID(), null, EXPIRY);

        // when
        boolean confirmed = booking.confirmPayment();
        boolean expired = booking.expirePayment(EXPIRY, UUID.randomUUID());

        // then
        assertThat(confirmed).isFalse();
        assertThat(expired).isFalse();
        assertThat(booking.getStatus()).isEqualTo(BookingStatus.CONFIRMED);
    }

    private UUID insertBooking(String status, UUID bookedBy, Instant expiresAt) {
        UUID id = UUID.randomUUID();
        jdbc.sql("""
                        INSERT INTO booking (id, card_id, status, booked_by, payment_expires_at)
                        VALUES (?, ?, ?, ?, ?)
                        """)
                .params(id, MEMBER_BOOKING_CARD, status, bookedBy,
                        expiresAt == null ? null : expiresAt.atOffset(ZoneOffset.UTC))
                .update();
        return id;
    }

    private void insertAllocation(UUID bookingId, String status) {
        jdbc.sql("""
                        INSERT INTO court_allocation (id, booking_id, court_id, starts_at, ends_at, status)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """)
                .params(UUID.randomUUID(), bookingId, court,
                        SIX_PM.atOffset(ZoneOffset.UTC), SEVEN_PM.atOffset(ZoneOffset.UTC), status)
                .update();
    }
}
