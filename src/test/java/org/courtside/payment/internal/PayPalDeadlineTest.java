package org.courtside.payment.internal;

import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PayPalDeadlineTest {

    @Test
    void givenNoDeadline_whenAskingForATimeout_thenTheRequestTimeoutHolds() {
        // when
        Duration timeout = PayPalDeadline.NONE.timeout(Duration.ofSeconds(10));

        // then
        assertThat(timeout).isEqualTo(Duration.ofSeconds(10));
        assertThat(PayPalDeadline.NONE.leaves(Duration.ofDays(1))).as("the job is bounded per request only").isTrue();
    }

    @Test
    void givenADeadlineNearerThanTheRequestTimeout_whenAskingForATimeout_thenOnlyTheTimeLeftIsGiven() {
        // given
        PayPalDeadline deadline = PayPalDeadline.after(Duration.ofSeconds(5));

        // when
        Duration timeout = deadline.timeout(Duration.ofSeconds(10));

        // then
        assertThat(timeout).isPositive().isLessThanOrEqualTo(Duration.ofSeconds(5));
        assertThat(deadline.leaves(Duration.ofSeconds(10))).as("not enough left for a whole request").isFalse();
        assertThat(deadline.leaves(Duration.ofMillis(1))).isTrue();
    }

    @Test
    void givenAUsedUpDeadline_whenAskingForATimeout_thenNoRequestMayStart() {
        // given
        PayPalDeadline deadline = PayPalDeadline.after(Duration.ZERO);

        // when / then
        assertThatThrownBy(() -> deadline.timeout(Duration.ofSeconds(10)))
                .isInstanceOf(PayPalUnavailableException.class).hasMessageContaining("used up");
    }
}
