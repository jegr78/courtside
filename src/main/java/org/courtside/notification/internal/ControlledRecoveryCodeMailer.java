package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubIdentity;
import org.courtside.identity.UserAccountRepository;
import org.courtside.notification.MessageKind;
import org.courtside.shared.IssuedResetCode;
import org.courtside.identity.ControlledRecoveryCodeIssuer;
import org.courtside.identity.ControlledRecoveryRequested;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.FormatStyle;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

@Component
@RequiredArgsConstructor
class ControlledRecoveryCodeMailer implements MessageComposer {

    private final ControlledRecoveryCodeIssuer codes;
    private final UserAccountRepository accounts;
    private final ClubIdentity club;
    private final MailTemplates templates;
    private final InstanceLinks links;
    private final MessageOutbox outbox;

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT, fallbackExecution = true)
    void on(ControlledRecoveryRequested requested) {
        outbox.queue(requested.accountId(), MessageKind.ACCOUNT_MFA_RECOVERY_CODE, Map.of("recoveryId", requested.recoveryId().toString()));
    }

    @Override
    public Set<MessageKind> kinds() {
        return Set.of(MessageKind.ACCOUNT_MFA_RECOVERY_CODE);
    }

    @Override
    public void compose(QueuedMessage message, Consumer<OutgoingMail> handOver) {
        MessageRecipient.required(accounts, message.accountId());
        IssuedResetCode issued = codes.issueFor(message.accountId(), java.util.UUID.fromString(message.parameters().get("recoveryId")));
        Locale locale = MessageLanguage.of(issued.recipientLocale(), club.defaultLocale());
        String key = MessageKind.ACCOUNT_MFA_RECOVERY_CODE.templateKey();
        Map<String, String> values = Map.of(
                "clubName", club.clubName(),
                "firstName", issued.recipientFirstName(),
                "username", issued.username(),
                "resetCode", issued.code(),
                "expiresAt", expiresAt(issued.expiresAt(), locale),
                InstanceLinks.PLACEHOLDER, links.root());
        handOver.accept(new OutgoingMail(issued.recipientAddress(),
                templates.render(key + ".subject", locale, values),
                templates.render(key + ".body", locale, values)));
    }

    private String expiresAt(Instant expiresAt, Locale locale) {
        return DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT).withLocale(locale)
                .format(LocalDateTime.ofInstant(expiresAt, club.zoneId()));
    }
}
