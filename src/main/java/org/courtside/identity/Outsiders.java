package org.courtside.identity;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.Set;
import java.util.UUID;

/** An outsider holds the external role, no running membership and is no administrator; member-only features stay closed to it. */
@Component
@RequiredArgsConstructor
public class Outsiders {

    private final MembershipStanding membership;
    private final UserAccountRepository accounts;

    public boolean isOutsider(UUID accountId, Set<Role> roles) {
        return roles != null && roles.contains(Role.EXTERNAL) && !roles.contains(Role.ADMIN)
                && (accountId == null || !membership.holdsRunningMembership(accountId));
    }

    public void refuseAccount(UUID accountId) {
        refuse(accountId, accountId == null ? Set.of()
                : accounts.findById(accountId).map(UserAccount::getRoles).orElse(Set.of()));
    }

    public void refuse(UUID accountId, Set<Role> roles) {
        if (isOutsider(accountId, roles)) {
            throw new OutsiderRefusedException();
        }
    }
}
