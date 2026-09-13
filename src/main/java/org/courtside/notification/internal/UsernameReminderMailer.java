package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubIdentity;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.notification.MessageKind;
import org.courtside.shared.UsernameReminderRequested;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.Locale;
import java.util.Map;

@Component
@RequiredArgsConstructor
class UsernameReminderMailer {

    private final UserAccountRepository accounts;
    private final ClubIdentity club;
    private final MailTemplates templates;
    private final RecordedHandover handover;

    @Async("credentialMailExecutor")
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    @TransactionalEventListener
    void on(UsernameReminderRequested requested) {
        MessageRecipient.reachable(accounts.findById(requested.accountId())).ifPresent(this::remind);
    }

    private void remind(UserAccount account) {
        Locale locale = MessageLanguage.of(account.getLocale(), club.defaultLocale());
        String key = MessageKind.ACCOUNT_USERNAME_REMINDER.templateKey();
        Map<String, String> values = Map.of(
                "clubName", club.clubName(),
                "firstName", account.getPerson().getFirstName(),
                "username", account.getUsername());
        handover.handOver(account.getId(), MessageKind.ACCOUNT_USERNAME_REMINDER,
                account.getPerson().getEmail(),
                templates.render(key + ".subject", locale, values),
                templates.render(key + ".body", locale, values));
    }
}
