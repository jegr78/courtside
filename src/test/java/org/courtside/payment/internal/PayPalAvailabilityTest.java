package org.courtside.payment.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.payment.testfixture.PaymentTestFixture;
import org.courtside.shared.InstanceAddress;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

import static org.assertj.core.api.Assertions.assertThat;

@Import(PaymentTestFixture.class)
class PayPalAvailabilityTest extends AbstractIntegrationTest {

    private static final InstanceAddress PUBLISHED = new InstanceAddress("https://courts.example.org");

    @Autowired
    private JdbcClient jdbc;
    @Autowired
    private PaymentTestFixture payment;

    @Test
    void givenPayPalSwitchedOnWithASecretAndAPublicAddress_whenAsked_thenPayPalIsAvailable() {
        // given
        payment.storePayPal(true);

        // when
        boolean available = new PayPalAvailability(jdbc, PUBLISHED).payPalAvailable();

        // then
        assertThat(available).isTrue();
    }

    @Test
    void givenPayPalSwitchedOnWithoutAPublicAddress_whenAsked_thenPayPalIsUnavailable() {
        // given
        payment.storePayPal(true);

        // when
        boolean available = new PayPalAvailability(jdbc, new InstanceAddress("")).payPalAvailable();

        // then
        assertThat(available).as("PayPal could not send the booker back").isFalse();
    }

    @Test
    void givenPayPalSwitchedOffOrNeverStored_whenAsked_thenPayPalIsUnavailable() {
        // given
        boolean neverStored = new PayPalAvailability(jdbc, PUBLISHED).payPalAvailable();
        payment.storePayPal(false);

        // when
        boolean switchedOff = new PayPalAvailability(jdbc, PUBLISHED).payPalAvailable();

        // then
        assertThat(neverStored).as("no settings").isFalse();
        assertThat(switchedOff).as("switched off").isFalse();
    }
}
