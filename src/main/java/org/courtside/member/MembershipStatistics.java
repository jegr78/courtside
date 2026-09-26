package org.courtside.member;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public interface MembershipStatistics {

    record MembershipFigures(long running, long joins, long leavings) {
    }

    record MembershipTypeCount(UUID membershipTypeId, String name, long members) {
    }

    MembershipFigures figures(LocalDate from, LocalDate to);

    List<MembershipTypeCount> runningByType(LocalDate day);
}
