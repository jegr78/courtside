package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubIdentity;
import org.courtside.identity.AccountAddressChanged;
import org.courtside.identity.UserAccountRepository;
import org.courtside.notification.MessageKind;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

// The previous address waits only in its outbox row until the row settles; the centre never holds it.
@Component
@RequiredArgsConstructor
class AccountAddressChangeMailer implements MessageComposer {
    private final UserAccountRepository accounts;
    private final ClubIdentity club;
    private final MailTemplates templates;
    private final InstanceLinks links;
    private final MessageOutbox outbox;

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    void on(AccountAddressChanged changed) {
        outbox.queueToPreviousAddress(changed.accountId(), MessageKind.ACCOUNT_ADDRESS_CHANGED,
                changed.previousAddress());
    }

    @Override
    public Set<MessageKind> kinds() {
        return Set.of(MessageKind.ACCOUNT_ADDRESS_CHANGED);
    }

    @Override
    public void compose(QueuedMessage message, Consumer<OutgoingMail> handOver) {
        String previous = message.previousAddress();
        if (previous == null || previous.isBlank()) {
            throw new MessageUndeliverableException("ParameterMissing");
        }
        var account = MessageRecipient.enabled(accounts.findById(message.accountId()))
                .orElseThrow(() -> new MessageUndeliverableException("RecipientUnreachable"));
        Locale locale = MessageLanguage.of(account.getLocale(), club.defaultLocale());
        String key = message.kind().templateKey();
        Map<String, String> values = Map.of("clubName", club.clubName(),
                "firstName", account.getPerson().getFirstName(), InstanceLinks.PLACEHOLDER, links.of(message));
        handOver.accept(new OutgoingMail(previous,
                templates.render(key + ".subject", locale, values), templates.render(key + ".body", locale, values)));
    }
}
