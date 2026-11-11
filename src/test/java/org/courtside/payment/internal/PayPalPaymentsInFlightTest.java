package org.courtside.payment.internal;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.simple.JdbcClient;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

class PayPalPaymentsInFlightTest {

    @Test
    void givenNoAccount_whenAskedForMoneyInFlight_thenItIsRefused() {
        // given
        JdbcClient jdbc = mock(JdbcClient.class);

        // when / then
        assertThatThrownBy(() -> new PayPalPaymentsInFlight(jdbc).moneyHeldBy(null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Money is held by an account");
        verifyNoInteractions(jdbc);
    }
}
