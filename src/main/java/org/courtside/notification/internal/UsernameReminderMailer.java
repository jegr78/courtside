package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubIdentity;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.notification.MessageKind;
import org.courtside.shared.UsernameReminderRequested;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

@Component
@RequiredArgsConstructor
class UsernameReminderMailer implements MessageComposer {

    private final UserAccountRepository accounts;
    private final ClubIdentity club;
    private final MailTemplates templates;
    private final MessageOutbox outbox;

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT, fallbackExecution = true)
    void on(UsernameReminderRequested requested) {
        MessageRecipient.reachable(accounts.findById(requested.accountId())).ifPresent(account ->
                outbox.queue(account.getId(), MessageKind.ACCOUNT_USERNAME_REMINDER, Map.of()));
    }

    @Override
    public Set<MessageKind> kinds() {
        return Set.of(MessageKind.ACCOUNT_USERNAME_REMINDER);
    }

    @Override
    public void compose(QueuedMessage message, Consumer<OutgoingMail> handOver) {
        UserAccount account = MessageRecipient.required(accounts, message.accountId());
        Locale locale = MessageLanguage.of(account.getLocale(), club.defaultLocale());
        String key = MessageKind.ACCOUNT_USERNAME_REMINDER.templateKey();
        Map<String, String> values = Map.of(
                "clubName", club.clubName(),
                "firstName", account.getPerson().getFirstName(),
                "username", account.getUsername());
        handOver.accept(new OutgoingMail(account.getPerson().getEmail(),
                templates.render(key + ".subject", locale, values),
                templates.render(key + ".body", locale, values)));
    }
}
