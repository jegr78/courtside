package org.courtside.member;

import java.time.LocalDate;

public record MembershipPeriod(LocalDate startedOn, LocalDate endedOn) {

    public MembershipPeriod {
        if (startedOn != null && endedOn != null && endedOn.isBefore(startedOn)) {
            throw new InvalidMembershipPeriodException("membershipPeriod.endsBeforeItBegan",
                    "A membership ends after the day it began");
        }
        if (startedOn != null && startedOn.equals(endedOn)) {
            throw new InvalidMembershipPeriodException("membershipPeriod.coversNoDay",
                    "A membership period ending on its first day covers no day");
        }
    }

    public static MembershipPeriod running() {
        return new MembershipPeriod(null, null);
    }

    public MembershipPeriod requireStart() {
        if (startedOn == null) {
            throw new InvalidMembershipPeriodException("membershipPeriod.startRequired",
                    "A membership period names the day it begins");
        }
        return this;
    }

    public boolean isCurrent() {
        return endedOn == null;
    }
}
