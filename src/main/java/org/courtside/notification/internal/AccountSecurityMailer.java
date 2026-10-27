package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubIdentity;
import org.courtside.identity.AccountMfaChanged;
import org.courtside.identity.UserAccountRepository;
import org.courtside.notification.MessageKind;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

@Component
@RequiredArgsConstructor
class AccountSecurityMailer implements MessageComposer {
    private final UserAccountRepository accounts;
    private final ClubIdentity club;
    private final MailTemplates templates;
    private final InstanceLinks links;
    private final MessageOutbox outbox;

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    void on(AccountMfaChanged changed) {
        outbox.queue(changed.accountId(), MessageKind.ACCOUNT_SECURITY_CHANGED, Map.of());
    }

    @Override
    public Set<MessageKind> kinds() {
        return Set.of(MessageKind.ACCOUNT_SECURITY_CHANGED);
    }

    @Override
    public void compose(QueuedMessage message, Consumer<OutgoingMail> handOver) {
        var account = MessageRecipient.required(accounts, message.accountId());
        Locale locale = MessageLanguage.of(account.getLocale(), club.defaultLocale());
        String key = message.kind().templateKey();
        Map<String, String> values = Map.of("clubName", club.clubName(),
                "firstName", account.getPerson().getFirstName(), InstanceLinks.PLACEHOLDER, links.of(message));
        handOver.accept(new OutgoingMail(account.getPerson().getEmail(),
                templates.render(key + ".subject", locale, values), templates.render(key + ".body", locale, values)));
    }
}
