package org.courtside.member.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.MembershipStanding;
import org.courtside.member.MemberRepository;
import org.courtside.config.ClubTimeZone;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.LocalDate;
import java.util.UUID;

@Component
@RequiredArgsConstructor
class MemberMembershipStanding implements MembershipStanding {

    private final MemberRepository members;
    private final Clock clock;
    private final ClubTimeZone clubTimeZone;

    @Override
    public boolean holdsRunningMembership(UUID accountId) {
        return accountId != null
                && members.isCurrentMemberAccount(accountId, LocalDate.now(clock.withZone(clubTimeZone.zoneId())));
    }
}
