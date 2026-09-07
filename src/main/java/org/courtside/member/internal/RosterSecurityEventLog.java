package org.courtside.member.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.CurrentUser;
import org.courtside.member.RosterEvent;
import org.courtside.shared.SecurityEventLog;
import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.UUID;

@Component
@RequiredArgsConstructor
class RosterSecurityEventLog {

    private final CurrentUser currentUser;
    private final SecurityEventLog securityEvents;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    void record(RosterEvent event) {
        UUID actor = currentUser.accountId().orElse(null);
        Action action = switch (event) {
            case RosterEvent.AccountCreated created -> new Action(
                    created.accountId(), SecurityEventLog.AdministrativeAction.ACCOUNT_CREATED);
            case RosterEvent.AccountRolesChanged changed -> new Action(
                    changed.accountId(), SecurityEventLog.AdministrativeAction.ROLES_CHANGED);
            case RosterEvent.AccountUsernameCorrected corrected -> new Action(
                    corrected.accountId(), SecurityEventLog.AdministrativeAction.USERNAME_CHANGED);
            case RosterEvent.AccountCredentialsRequested requested -> new Action(
                    requested.accountId(), SecurityEventLog.AdministrativeAction.CREDENTIAL_REQUESTED);
            case RosterEvent.AccountAvailabilityChanged changed -> new Action(changed.accountId(),
                    changed.enabled() ? SecurityEventLog.AdministrativeAction.ACCOUNT_ENABLED
                            : SecurityEventLog.AdministrativeAction.ACCOUNT_DISABLED);
            case RosterEvent.PersonAdded ignored -> null;
            case RosterEvent.PersonCorrected ignored -> null;
            case RosterEvent.AccountLocaleCorrected ignored -> null;
            case RosterEvent.MembershipWritten ignored -> null;
            case RosterEvent.MembershipEnded ignored -> null;
        };
        if (action != null) {
            write(action.accountId(), actor, action.action());
        }
    }

    private void write(UUID accountId, @Nullable UUID actor, SecurityEventLog.AdministrativeAction action) {
        securityEvents.administrativeAction(accountId, actor, action);
    }

    private record Action(UUID accountId, SecurityEventLog.AdministrativeAction action) {
    }
}
