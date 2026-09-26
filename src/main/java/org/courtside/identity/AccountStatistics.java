package org.courtside.identity;

import java.time.LocalDate;

public interface AccountStatistics {

    record AccountFigures(long accounts, long passwordChosen, long withoutChosenPassword,
                          long signedInWithin30Days, long signedInWithin90Days, long neverSignedIn) {
    }

    AccountFigures figuresAsOf(LocalDate lastDay);
}
