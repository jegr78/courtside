package org.courtside.shared;

import java.util.UUID;

/** Whether money the club holds for an account is still on its credit ledger. */
public interface HeldCredit {

    boolean heldBy(UUID accountId);

    /** Holds the account's ledger against every write until the transaction ends. */
    void lock(UUID accountId);

    boolean heldByAnyone();
}
