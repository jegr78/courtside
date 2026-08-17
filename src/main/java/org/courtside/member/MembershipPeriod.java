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

    public MembershipPeriod requireNotInTheFuture(LocalDate today) {
        if (isAfter(startedOn, today) || isAfter(endedOn, today)) {
            throw new InvalidMembershipPeriodException("membershipPeriod.inTheFuture",
                    "A membership is recorded once it has begun, not scheduled in advance");
        }
        return this;
    }

    public boolean isCurrent() {
        return endedOn == null;
    }

    private static boolean isAfter(LocalDate date, LocalDate today) {
        return date != null && date.isAfter(today);
    }
}
