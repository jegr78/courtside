package org.courtside.payment;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Import(IdentityTestFixture.class)
class PayPalRefundSchemaTest extends AbstractIntegrationTest {

    private static final String ORDER = "ORDER-REFUND-1";

    @Autowired
    private JdbcClient jdbc;
    @Autowired
    private IdentityTestFixture identity;

    private UUID account;

    @BeforeEach
    void setUp() {
        account = identity.createEnabledAccount(identity.createPerson("Jane", "Doe"), "jane.doe",
                Set.of(Role.EXTERNAL));
        jdbc.sql("INSERT INTO credit_account (account_id) VALUES (?)").param(account).update();
        jdbc.sql("""
                        INSERT INTO paypal_order (order_id, booking_id, account_id, environment, amount_minor, currency,
                                                  status, capture_id, approve_url, created_at, updated_at)
                        VALUES (?, ?, ?, 'SANDBOX', 1500, 'EUR', 'CAPTURED', 'CAPTURE1',
                                'https://www.sandbox.paypal.com/x', now(), now())
                        """)
                .params(ORDER, UUID.randomUUID(), account)
                .update();
    }

    @Test
    void givenARefundRow_whenInsertedForAKnownOrder_thenItIsStored() {
        // when
        insertRefund(ORDER, 1500, "EUR", "PENDING", null, null);

        // then
        assertThat(jdbc.sql("SELECT status FROM paypal_refund WHERE order_id = ?").param(ORDER)
                .query(String.class).single()).isEqualTo("PENDING");
    }

    @Test
    void givenARefundOfAnOrder_whenASecondIsInserted_thenTheUniqueConstraintRefusesIt() {
        // given
        insertRefund(ORDER, 1500, "EUR", "FAILED", null, "Declined");

        // when / then
        assertThatThrownBy(() -> insertRefund(ORDER, 1500, "EUR", "PENDING", null, null))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("paypal_refund_one_per_order");
    }

    @Test
    void givenAnUnknownOrder_whenARefundIsInserted_thenTheForeignKeyRefusesIt() {
        // when / then
        assertThatThrownBy(() -> insertRefund("ORDER-UNKNOWN", 1500, "EUR", "PENDING", null, null))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("paypal_refund_order");
    }

    @ParameterizedTest
    @CsvSource(value = {
            "0,EUR,PENDING,,,paypal_refund_amount_positive",
            "1500,eur,PENDING,,,paypal_refund_currency_code",
            "1500,EUR,REFUNDED,REFUND1,,paypal_refund_status",
            "1500,EUR,COMPLETED,,,paypal_refund_completed_has_id",
            "1500,EUR,FAILED,,,paypal_refund_failure_reason",
            "1500,EUR,PENDING,,Declined,paypal_refund_failure_reason",
            "1500,EUR,COMPLETED,REFUND1,Declined,paypal_refund_failure_reason",
            "1500,EUR,FAILED,,' ',paypal_refund_failure_reason_length"})
    void givenARefundRowBreakingACheck_whenInserted_thenTheCheckRefusesIt(int amountMinor, String currency,
                                                                          String status, String refundId,
                                                                          String failureReason, String constraint) {
        // when / then
        assertThatThrownBy(() -> insertRefund(ORDER, amountMinor, currency, status, refundId, failureReason))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining(constraint);
    }

    @Test
    void givenAFailureReasonOverTwoHundredCharacters_whenInserted_thenTheLengthCheckRefusesIt() {
        // when / then
        assertThatThrownBy(() -> insertRefund(ORDER, 1500, "EUR", "FAILED", null, "x".repeat(201)))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("paypal_refund_failure_reason_length");
    }

    @ParameterizedTest
    @CsvSource(value = {
            "PAYPAL_REFUND,1500,ORDER-REFUND-1,credit_entry_kind_sign",
            "PAYPAL_REFUND_REVERSED,-1500,ORDER-REFUND-1,credit_entry_kind_sign",
            "PAYPAL_REFUND,-1500,,credit_entry_paypal_order_reference",
            "PAYPAL_REFUND_REVERSED,1500,,credit_entry_paypal_order_reference"})
    void givenARefundLedgerEntryBreakingACheck_whenInserted_thenTheCheckRefusesIt(String kind, int amountMinor,
                                                                                  String orderId, String constraint) {
        // when / then
        assertThatThrownBy(() -> jdbc.sql("""
                        INSERT INTO credit_entry (id, account_id, kind, amount_minor, currency, recorded_at, booking_id,
                                                  paypal_order_id)
                        VALUES (?, ?, ?, ?, 'EUR', now(), ?, ?)
                        """)
                .params(UUID.randomUUID(), account, kind, amountMinor, UUID.randomUUID(), orderId)
                .update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining(constraint);
    }

    @Test
    void givenARefundLedgerEntry_whenItNamesNoBooking_thenTheBookingReferenceRefusesIt() {
        // when / then
        assertThatThrownBy(() -> jdbc.sql("""
                        INSERT INTO credit_entry (id, account_id, kind, amount_minor, currency, recorded_at,
                                                  paypal_order_id)
                        VALUES (?, ?, 'PAYPAL_REFUND', -1500, 'EUR', now(), ?)
                        """)
                .params(UUID.randomUUID(), account, ORDER)
                .update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("credit_entry_booking_reference");
    }

    @Test
    void givenACapturedOrder_whenASecondCaptureKindNamesIt_thenTheIndexRefusesIt() {
        // given
        insertEntry("PAYPAL_PAYMENT", 1500);

        // when / then
        assertThatThrownBy(() -> insertEntry("PAYPAL_LATE_CAPTURE", 1500))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("\"credit_entry_paypal_order\"");
    }

    @Test
    void givenACapturedOrder_whenItsRefundAndReversalAreRecorded_thenAllThreeEntriesAreStored() {
        // given
        insertEntry("PAYPAL_PAYMENT", 1500);

        // when
        insertEntry("PAYPAL_REFUND", -1500);
        insertEntry("PAYPAL_REFUND_REVERSED", 1500);

        // then
        assertThat(jdbc.sql("SELECT count(*) FROM credit_entry WHERE paypal_order_id = ?").param(ORDER)
                .query(Integer.class).single()).isEqualTo(3);
    }

    private void insertEntry(String kind, int amountMinor) {
        jdbc.sql("""
                        INSERT INTO credit_entry (id, account_id, kind, amount_minor, currency, recorded_at, booking_id,
                                                  paypal_order_id)
                        VALUES (?, ?, ?, ?, 'EUR', now(), ?, ?)
                        """)
                .params(UUID.randomUUID(), account, kind, amountMinor, UUID.randomUUID(), ORDER)
                .update();
    }

    private void insertRefund(String orderId, int amountMinor, String currency, String status, String refundId,
                              String failureReason) {
        jdbc.sql("""
                        INSERT INTO paypal_refund (id, order_id, account_id, amount_minor, currency, status, refund_id,
                                                   failure_reason, requested_by, requested_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, now(), now())
                        """)
                .params(UUID.randomUUID(), orderId, account, amountMinor, currency, status, refundId, failureReason,
                        UUID.randomUUID())
                .update();
    }
}
