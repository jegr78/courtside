package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.shared.PasswordResetRequested;
import org.courtside.shared.UsernameReminderRequested;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Locale;
import java.util.Optional;

@Slf4j
@Service
@RequiredArgsConstructor
class AccountRecoveryService {

    private final UserAccountRepository accounts;
    private final PasswordResetMailLimit mailLimit;
    private final PasswordResetTokenService resetTokens;
    private final LoginAttemptProtection protection;
    private final ApplicationEventPublisher events;

    @Transactional
    void mailAResetCode(String username, String callerAddress) {
        refuseWhenLimited(username, callerAddress);
        accounts.findByUsername(username)
                .filter(AccountRecoveryService::reachable)
                .ifPresent(this::mailACodeUnlessTheMailboxHasHadEnough);
    }

    @Transactional
    void remindOfUsernames(String email, String callerAddress) {
        refuseWhenLimited(email, callerAddress);
        accounts.findByPersonEmailIgnoringCase(email).stream()
                .filter(AccountRecoveryService::reachable)
                .forEach(account ->
                        events.publishEvent(new UsernameReminderRequested(account.getId())));
    }

    void redeemPasswordReset(String code, String password) {
        resetTokens.redeem(code, password);
    }

    // The per-account window spares a mailbox, it does not answer questions: letting it reach an
    // unauthenticated caller would tell them the name they guessed belongs to somebody.
    private void mailACodeUnlessTheMailboxHasHadEnough(UserAccount account) {
        if (!mailLimit.recordWithinWindow(account.getId())) {
            log.debug("Recovery found the reset-mail window already met for account {}",
                    account.getId());
            return;
        }
        events.publishEvent(new PasswordResetRequested(account.getId()));
    }

    private void refuseWhenLimited(String subject, String callerAddress) {
        Optional<LoginBlock> block = protection.registerRecoveryAttempt(
                subject.strip().toLowerCase(Locale.ROOT), callerAddress);
        if (block.isPresent()) {
            throw new AccountRecoveryRateLimitedException(block.get());
        }
    }

    private static boolean reachable(UserAccount account) {
        String address = account.getPerson().getEmail();
        return account.isEnabled() && address != null && !address.isBlank();
    }
}
