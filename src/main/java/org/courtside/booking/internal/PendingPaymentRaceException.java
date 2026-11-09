package org.courtside.booking.internal;

import org.springframework.dao.ConcurrencyFailureException;

/** Another pending booking of the account committed during this write; a retry reports it as a violation. */
public class PendingPaymentRaceException extends ConcurrencyFailureException {

    public PendingPaymentRaceException(Throwable cause) {
        super("Another pending booking of the account committed first", cause);
    }
}
