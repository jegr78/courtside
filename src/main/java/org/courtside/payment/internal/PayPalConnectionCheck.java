package org.courtside.payment.internal;

import lombok.extern.slf4j.Slf4j;
import org.courtside.payment.PayPalEnvironment;
import org.jspecify.annotations.Nullable;

@Slf4j
public class PayPalConnectionCheck {

    static final int MAX_REASON = PayPalClient.MAX_REASON;

    private final PayPalClient client;

    PayPalConnectionCheck(PayPalClient client) {
        this.client = client;
    }

    Result check(PayPalEnvironment environment, String clientId, String secret) {
        try {
            PayPalClient.Answer answer = client.requestToken(environment, clientId, secret);
            if (answer.status() / 100 == 2) {
                log.info("PayPal {} accepted the stored credentials", environment);
                return new Result(Outcome.OK, null);
            }
            log.info("PayPal {} refused the stored credentials with status {}", environment, answer.status());
            return new Result(Outcome.REJECTED, PayPalClient.reason(answer.status(), answer.body()));
        } catch (PayPalUnavailableException unreachable) {
            return new Result(Outcome.UNREACHABLE, null);
        }
    }

    public enum Outcome { OK, REJECTED, UNREACHABLE, NOT_CONFIGURED }

    public record Result(Outcome outcome, @Nullable String providerReason) {
    }
}
