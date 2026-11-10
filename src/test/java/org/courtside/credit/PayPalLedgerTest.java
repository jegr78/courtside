package org.courtside.credit;

import org.courtside.AbstractIntegrationTest;
import org.courtside.credit.BookingPayments.PaymentMethod;
import org.courtside.credit.internal.CreditLedger;
import org.courtside.credit.testfixture.CreditTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.Currency;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PayPalLedgerTest extends AbstractIntegrationTest {

    private static final Currency EURO = Currency.getInstance("EUR");

    @Autowired
    private IdentityTestFixture identity;
    @Autowired
    private CreditTestFixture credit;
    @Autowired
    private CreditLedger ledger;
    @Autowired
    private JdbcClient jdbc;
    @Autowired
    private TransactionTemplate transactions;

    private UUID johnAccount;

    @BeforeEach
    void setUp() {
        UUID john = identity.createPerson("John", "Roe", "john.roe@example.org");
        johnAccount = identity.createEnabledAccount(john, "roe.john", Set.of(Role.EXTERNAL));
    }

    @Test
    void givenAPayPalCapture_whenRecorded_thenTheBalanceIsUnchangedAndBothEntriesNameTheBooking() {
        // given
        credit.credit(johnAccount, 500);
        UUID booking = UUID.randomUUID();

        // when
        transactions.executeWithoutResult(status -> ledger.payByPayPal(johnAccount, booking, "ORDER-1", 1800, EURO));

        // then
        assertThat(credit.balance(johnAccount)).as("the capture pays the booking and leaves the balance").isEqualTo(500);
        assertThat(kindsOf(booking)).containsExactlyInAnyOrder("PAYPAL_PAYMENT:1800", "BOOKING_DEBIT:-1800");
        assertThat(jdbc.sql("SELECT paypal_order_id FROM credit_entry WHERE booking_id = :b AND kind = 'PAYPAL_PAYMENT'")
                .param("b", booking).query(String.class).single()).isEqualTo("ORDER-1");
    }

    @Test
    void givenAPayPalPaidBooking_whenCancelledBeforeTheDeadline_thenTheRefundReturnsTheAmountToCredit() {
        // given
        UUID booking = UUID.randomUUID();
        transactions.executeWithoutResult(status -> ledger.payByPayPal(johnAccount, booking, "ORDER-2", 1800, EURO));

        // when
        transactions.executeWithoutResult(status -> ledger.refund(booking));

        // then
        assertThat(credit.balance(johnAccount)).as("the refund lands as credit").isEqualTo(1800);
        assertThat(kindsOf(booking)).contains("BOOKING_REFUND:1800");
    }

    @Test
    void givenALateCapture_whenRecorded_thenTheBalanceGrowsByTheAmount() {
        // given
        UUID booking = UUID.randomUUID();

        // when
        boolean credited = transactions.execute(status ->
                ledger.creditLateCapture(johnAccount, booking, "ORDER-3", 1800, EURO));

        // then
        assertThat(credited).isTrue();
        assertThat(credit.balance(johnAccount)).isEqualTo(1800);
        assertThat(kindsOf(booking)).containsExactly("PAYPAL_LATE_CAPTURE:1800");
    }

    @Test
    void givenAnAnonymisedAccount_whenALateCaptureArrives_thenNothingIsWrittenAndItReturnsFalse() {
        // given
        jdbc.sql("UPDATE user_account SET anonymised_at = now(), enabled = false, password_hash = NULL WHERE id = :id").param("id", johnAccount).update();
        UUID booking = UUID.randomUUID();

        // when
        boolean credited = transactions.execute(status ->
                ledger.creditLateCapture(johnAccount, booking, "ORDER-4", 1800, EURO));

        // then
        assertThat(credited).isFalse();
        assertThat(kindsOf(booking)).as("an anonymised account gets no entry").isEmpty();
    }

    @Test
    void givenTheSameOrder_whenRecordedTwice_thenTheDatabaseRefusesTheSecond() {
        // given
        transactions.executeWithoutResult(status ->
                ledger.payByPayPal(johnAccount, UUID.randomUUID(), "ORDER-5", 1800, EURO));

        // when / then
        assertThatThrownBy(() -> transactions.executeWithoutResult(status ->
                ledger.creditLateCapture(johnAccount, UUID.randomUUID(), "ORDER-5", 1800, EURO)))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("credit_entry_paypal_order");
    }

    @Test
    void givenAPayPalPayment_whenReadBack_thenItsMethodIsPayPal() {
        // given
        UUID paypal = UUID.randomUUID();
        UUID fromCredit = UUID.randomUUID();
        credit.credit(johnAccount, 1000);
        transactions.executeWithoutResult(status -> {
            ledger.payByPayPal(johnAccount, paypal, "ORDER-6", 1800, EURO);
            ledger.debit(johnAccount, fromCredit, 700, EURO);
        });

        // when
        var paypalPayment = ledger.paymentOf(paypal).orElseThrow();
        var creditPayment = ledger.paymentOf(fromCredit).orElseThrow();

        // then
        assertThat(paypalPayment.method()).isEqualTo(PaymentMethod.PAYPAL);
        assertThat(paypalPayment.amountMinor()).isEqualTo(1800);
        assertThat(creditPayment.method()).isEqualTo(PaymentMethod.CREDIT);
    }

    @Test
    void givenAnotherCurrency_whenAPayPalCaptureIsRecorded_thenItIsRefused() {
        // when / then
        assertThatThrownBy(() -> transactions.executeWithoutResult(status ->
                ledger.payByPayPal(johnAccount, UUID.randomUUID(), "ORDER-7", 1800, Currency.getInstance("USD"))))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void givenACoveredBalance_whenTakenForAPayPalRefund_thenARefundEntryOfMinusTheAmountIsRecorded() {
        // given
        UUID booking = cancelledPayPalBooking("ORDER-8", 1500);

        // when
        var reservation = transactions.execute(status ->
                ledger.takeForPayPalRefund(johnAccount, booking, "ORDER-8", 1500, EURO));

        // then
        assertThat(reservation).isEqualTo(new BookingPayments.RefundReservation(true, 0, "EUR"));
        assertThat(jdbc.sql("""
                        SELECT amount_minor || ':' || paypal_order_id || ':' || booking_id FROM credit_entry
                        WHERE account_id = :a AND kind = 'PAYPAL_REFUND'
                        """)
                .param("a", johnAccount).query(String.class).single())
                .as("the refund entry takes the amount back and names the order and the booking")
                .isEqualTo("-1500:ORDER-8:" + booking);
        assertThat(credit.balance(johnAccount)).isZero();
    }

    @Test
    void givenASpentCredit_whenTakenForAPayPalRefund_thenNothingIsRecordedAndTheBalanceIsReported() {
        // given
        UUID booking = cancelledPayPalBooking("ORDER-9", 1500);
        transactions.executeWithoutResult(status -> ledger.debit(johnAccount, UUID.randomUUID(), 1000, EURO));

        // when
        var reservation = transactions.execute(status ->
                ledger.takeForPayPalRefund(johnAccount, booking, "ORDER-9", 1500, EURO));

        // then
        assertThat(reservation).isEqualTo(new BookingPayments.RefundReservation(false, 500, "EUR"));
        assertThat(kindsOf(booking)).as("a refused reservation writes nothing").doesNotContain("PAYPAL_REFUND:-1500");
        assertThat(credit.balance(johnAccount)).isEqualTo(500);
    }

    @Test
    void givenATakenRefund_whenRestored_thenTheBalanceIsWhole() {
        // given
        UUID booking = cancelledPayPalBooking("ORDER-10", 1500);
        transactions.executeWithoutResult(status ->
                ledger.takeForPayPalRefund(johnAccount, booking, "ORDER-10", 1500, EURO));

        // when
        transactions.executeWithoutResult(status ->
                ledger.restoreAfterPayPalRefund(johnAccount, booking, "ORDER-10", 1500, EURO));

        // then
        assertThat(credit.balance(johnAccount)).isEqualTo(1500);
        assertThat(kindsOf(booking)).contains("PAYPAL_REFUND:-1500", "PAYPAL_REFUND_REVERSED:1500");
    }

    @Test
    void givenACancelledPayPalBooking_whenItsCreditIsRead_thenItIsCreditedBackWithTheEntryAmount() {
        // given
        UUID booking = cancelledPayPalBooking("ORDER-11", 1500);

        // when
        var paid = ledger.payPalCreditOf("ORDER-11");

        // then
        assertThat(paid).contains(new BookingPayments.PayPalCredit(johnAccount, booking, 1500, "EUR", true));
    }

    @Test
    void givenAConfirmedPayPalBooking_whenItsCreditIsRead_thenItIsNotCreditedBack() {
        // given
        UUID booking = UUID.randomUUID();
        transactions.executeWithoutResult(status -> ledger.payByPayPal(johnAccount, booking, "ORDER-12", 1500, EURO));

        // when
        var paid = ledger.payPalCreditOf("ORDER-12");

        // then
        assertThat(paid).contains(new BookingPayments.PayPalCredit(johnAccount, booking, 1500, "EUR", false));
        assertThat(ledger.payPalCreditOf("ORDER-UNKNOWN")).as("an order without a ledger entry has no credit").isEmpty();
    }

    @Test
    void givenALateCapture_whenItsCreditIsRead_thenItCarriesTheCapturedAmount() {
        // given
        UUID booking = UUID.randomUUID();
        transactions.execute(status -> ledger.creditLateCapture(johnAccount, booking, "ORDER-13", 1750, EURO));

        // when
        var paid = ledger.payPalCreditOf("ORDER-13");

        // then
        assertThat(paid).contains(new BookingPayments.PayPalCredit(johnAccount, booking, 1750, "EUR", true));
    }

    @Test
    void givenAPayPalRefund_whenAppendedByHand_thenItIsRefused() {
        // when / then
        assertThatThrownBy(() -> ledger.append(johnAccount, CreditEntryKind.PAYPAL_REFUND, 1500, "By hand"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("not tied to a booking");
    }

    @Test
    void givenASecondRefundEntryForOneOrder_whenInserted_thenTheIndexRefusesIt() {
        // given
        UUID booking = cancelledPayPalBooking("ORDER-14", 1500);
        transactions.executeWithoutResult(status ->
                ledger.takeForPayPalRefund(johnAccount, booking, "ORDER-14", 1500, EURO));

        // when / then
        assertThatThrownBy(() -> jdbc.sql("""
                        INSERT INTO credit_entry (id, account_id, kind, amount_minor, currency, recorded_at, booking_id,
                                                  paypal_order_id)
                        VALUES (:id, :a, 'PAYPAL_REFUND', -1500, 'EUR', now(), :b, 'ORDER-14')
                        """)
                .param("id", UUID.randomUUID()).param("a", johnAccount).param("b", UUID.randomUUID()).update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("credit_entry_paypal_order_kind");
    }

    private UUID cancelledPayPalBooking(String orderId, int amountMinor) {
        UUID booking = UUID.randomUUID();
        transactions.executeWithoutResult(status -> {
            ledger.payByPayPal(johnAccount, booking, orderId, amountMinor, EURO);
            ledger.refund(booking);
        });
        return booking;
    }

    private List<String> kindsOf(UUID booking) {
        return jdbc.sql("SELECT kind || ':' || amount_minor FROM credit_entry WHERE booking_id = :b")
                .param("b", booking).query(String.class).list();
    }
}
