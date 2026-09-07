package org.courtside.member.internal;

import org.courtside.identity.CurrentUser;
import org.courtside.identity.Role;
import org.courtside.member.RosterEvent;
import org.courtside.shared.SecurityEventLog;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.lang.reflect.Method;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class RosterSecurityEventLogTest {

    private static final UUID PERSON = UUID.fromString("00000000-0000-0000-0000-000000000201");
    private static final UUID ACCOUNT = UUID.fromString("00000000-0000-0000-0000-000000000202");
    private static final UUID ACTOR = UUID.fromString("00000000-0000-0000-0000-000000000203");

    private final CurrentUser currentUser = mock(CurrentUser.class);
    private final SecurityEventLog securityEvents = mock(SecurityEventLog.class);
    private final RosterSecurityEventLog listener = new RosterSecurityEventLog(currentUser, securityEvents);

    @Test
    void givenCommittedAccountAdministration_whenRecorded_thenStableActionsNameSubjectAndActor() {
        when(currentUser.accountId()).thenReturn(Optional.of(ACTOR));

        listener.record(new RosterEvent.AccountCreated(PERSON, ACCOUNT, Set.of(Role.MEMBER)));
        listener.record(new RosterEvent.AccountRolesChanged(PERSON, ACCOUNT, Set.of(Role.ADMIN)));
        listener.record(new RosterEvent.AccountUsernameCorrected(PERSON, ACCOUNT));
        listener.record(new RosterEvent.AccountCredentialsRequested(PERSON, ACCOUNT));
        listener.record(new RosterEvent.AccountAvailabilityChanged(PERSON, ACCOUNT, true));
        listener.record(new RosterEvent.AccountAvailabilityChanged(PERSON, ACCOUNT, false));

        verify(securityEvents).administrativeAction(
                ACCOUNT, ACTOR, SecurityEventLog.AdministrativeAction.ACCOUNT_CREATED);
        verify(securityEvents).administrativeAction(
                ACCOUNT, ACTOR, SecurityEventLog.AdministrativeAction.ROLES_CHANGED);
        verify(securityEvents).administrativeAction(
                ACCOUNT, ACTOR, SecurityEventLog.AdministrativeAction.USERNAME_CHANGED);
        verify(securityEvents).administrativeAction(
                ACCOUNT, ACTOR, SecurityEventLog.AdministrativeAction.CREDENTIAL_REQUESTED);
        verify(securityEvents).administrativeAction(
                ACCOUNT, ACTOR, SecurityEventLog.AdministrativeAction.ACCOUNT_ENABLED);
        verify(securityEvents).administrativeAction(
                ACCOUNT, ACTOR, SecurityEventLog.AdministrativeAction.ACCOUNT_DISABLED);
    }

    @Test
    void givenOrdinaryRosterMaintenance_whenRecorded_thenItIsNotMisclassifiedAsSecurityAdministration() {
        when(currentUser.accountId()).thenReturn(Optional.of(ACTOR));

        listener.record(new RosterEvent.PersonAdded(PERSON));
        listener.record(new RosterEvent.AccountLocaleCorrected(PERSON, ACCOUNT, "de"));

        verifyNoInteractions(securityEvents);
    }

    @Test
    void whenTheListenerContractIsInspected_thenSuccessIsOnlyEmittedAfterCommit() throws Exception {
        Method method = RosterSecurityEventLog.class.getDeclaredMethod("record", RosterEvent.class);

        TransactionalEventListener listenerContract =
                method.getAnnotation(TransactionalEventListener.class);

        assertThat(listenerContract.phase()).isEqualTo(TransactionPhase.AFTER_COMMIT);
    }
}
