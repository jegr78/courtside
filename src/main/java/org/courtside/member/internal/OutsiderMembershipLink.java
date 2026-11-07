package org.courtside.member.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.AccountAnonymisedException;
import org.courtside.identity.AccountSessions;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.member.RosterEvent;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

@Component
@RequiredArgsConstructor
public class OutsiderMembershipLink {

    private final UserAccountRepository accounts;
    private final AccountSessions sessions;
    private final ApplicationEventPublisher events;

    public void refuseAnonymised(UUID personId) {
        if (accounts.findWithLockByPersonIdIn(List.of(personId)).stream().anyMatch(UserAccount::isAnonymised)) {
            throw new AccountAnonymisedException();
        }
    }

    public void grantMemberRole(UUID personId, LocalDate endedOn, LocalDate today) {
        if (endedOn != null && !endedOn.isAfter(today)) {
            return;
        }
        for (UserAccount account : accounts.findWithLockByPersonIdIn(List.of(personId))) {
            Set<Role> roles = account.getRoles();
            if (roles.contains(Role.EXTERNAL) && !roles.contains(Role.MEMBER)) {
                Set<Role> linked = EnumSet.copyOf(roles);
                linked.add(Role.MEMBER);
                account.changeRoles(linked);
                sessions.revoke(account);
                events.publishEvent(new RosterEvent.AccountRolesChanged(personId, account.getId(), linked));
            }
        }
    }
}
