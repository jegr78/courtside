package org.courtside.rules;

import java.util.Optional;

public interface BookingHorizon {

    // The furthest any rule set lets a member book ahead; empty when no rule set bounds it.
    Optional<Integer> longestAdvanceDays();
}
