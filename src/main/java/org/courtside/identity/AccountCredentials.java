package org.courtside.identity;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.internal.CredentialIssuing;
import org.courtside.shared.CredentialsRequested;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class AccountCredentials {

    private final UserAccountRepository accounts;
    private final CredentialIssuing issuing;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    @Transactional
    public void issueTo(UUID accountId) {
        UserAccount account = accounts.findById(accountId).orElseThrow(() ->
                new IllegalStateException("No account to issue a credential for: " + accountId));
        if (!account.isEnabled()) {
            throw new AccountDeactivatedException();
        }
        issuing.registerOrRefuse(accountId);
        events.publishEvent(new CredentialsRequested(accountId, reasonFor(account)));
    }

    // Everything short of a password the member chose themselves is still the invitation, so the
    // longer of the two configured windows is the one a member who never got in keeps receiving.
    private CredentialsRequested.Reason reasonFor(UserAccount account) {
        return account.credentialState(clock.instant()) == CredentialState.PASSWORD_CHOSEN
                ? CredentialsRequested.Reason.PASSWORD_RESET
                : CredentialsRequested.Reason.NEW_ACCOUNT;
    }
}
