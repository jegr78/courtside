package org.courtside.shared;

import java.util.UUID;

/** Whether money the club holds for an account is still on its credit ledger. */
public interface HeldCredit {

    boolean heldBy(UUID accountId);

    boolean heldByAnyone();
}
