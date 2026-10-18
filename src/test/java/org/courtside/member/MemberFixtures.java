package org.courtside.member;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public final class MemberFixtures {

    public static final LocalDate MEMBER_SINCE = LocalDate.of(2026, 1, 1);

    private MemberFixtures() {
    }

    public static Member memberSince(UUID personId, UUID membershipTypeId) {
        return new Member(personId, membershipTypeId, MEMBER_SINCE);
    }

    public static Optional<Member> latestPeriodOf(MemberRepository members, UUID personId) {
        List<Member> periods = members.findByPersonIdOrderByStartedOnAscIdAsc(personId);
        return periods.isEmpty() ? Optional.empty() : Optional.of(periods.getLast());
    }
}
