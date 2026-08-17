package org.courtside.member;

import java.time.LocalDate;

public record MembershipPeriod(LocalDate startedOn, LocalDate endedOn) {

    public MembershipPeriod {
        if (startedOn != null && endedOn != null && endedOn.isBefore(startedOn)) {
            throw new InvalidMembershipPeriodException("membershipPeriod.endsBeforeItBegan",
                    "A membership ends on or after the day it began");
        }
    }

    public static MembershipPeriod running() {
        return new MembershipPeriod(null, null);
    }

    public boolean isRunning() {
        return endedOn == null;
    }
}
