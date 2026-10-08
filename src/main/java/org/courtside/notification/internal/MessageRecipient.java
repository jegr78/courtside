package org.courtside.notification.internal;

import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;

import java.util.Optional;
import java.util.UUID;

final class MessageRecipient {

    private MessageRecipient() {
    }

    // A deactivated account is refused a credential too: somebody who has left the club is not
    // written to, and an account with no address has nowhere to be written to.
    static Optional<UserAccount> reachable(Optional<UserAccount> account) {
        return account.filter(UserAccount::isEnabled)
                .filter(found -> found.getPerson().getEmail() != null
                        && !found.getPerson().getEmail().isBlank());
    }

    static UserAccount required(UserAccountRepository accounts, UUID accountId) {
        return reachable(accounts.findById(accountId))
                .orElseThrow(() -> new MessageUndeliverableException("RecipientUnreachable"));
    }
}
