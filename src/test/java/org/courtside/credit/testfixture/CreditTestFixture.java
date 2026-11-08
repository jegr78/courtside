package org.courtside.credit.testfixture;

import lombok.RequiredArgsConstructor;
import org.courtside.credit.CreditEntryKind;
import org.courtside.credit.internal.CreditLedger;

import java.util.UUID;

@RequiredArgsConstructor
public final class CreditTestFixture {

    private final CreditLedger ledger;

    public UUID credit(UUID accountId, int amountMinor) {
        return ledger.append(accountId, CreditEntryKind.CREDIT, amountMinor, "Cash at the clubhouse").id();
    }

    public UUID payOut(UUID accountId, int amountMinor) {
        return ledger.append(accountId, CreditEntryKind.PAYOUT, amountMinor, "Paid out in cash").id();
    }
}
