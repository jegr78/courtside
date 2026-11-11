package org.courtside.shared;

import java.util.UUID;

/** The money an account still has with the club: a credit balance, or a PayPal order or refund not yet settled. */
public interface PaymentsInFlight {

    /** Both answers come from one statement, so a payment settling in between cannot fall through the gap. */
    MoneyHeld moneyHeldBy(UUID accountId);

    record MoneyHeld(boolean credit, boolean payment) {
    }
}
