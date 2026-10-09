package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubIdentity;
import org.courtside.identity.UserAccountRepository;
import org.courtside.notification.MessageKind;
import org.courtside.shared.IssuedResetCode;
import org.courtside.shared.PasswordResetCodeIssuer;
import org.courtside.shared.PasswordResetRequested;
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
class PasswordResetCodeMailer implements MessageComposer {

    private final PasswordResetCodeIssuer codes;
    private final UserAccountRepository accounts;
    private final ClubIdentity club;
    private final MailTemplates templates;
    private final MessageOutbox outbox;

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT, fallbackExecution = true)
    void on(PasswordResetRequested requested) {
        outbox.queue(requested.accountId(), MessageKind.ACCOUNT_PASSWORD_RESET_CODE, Map.of());
    }

    @Override
    public Set<MessageKind> kinds() {
        return Set.of(MessageKind.ACCOUNT_PASSWORD_RESET_CODE);
    }

    // The code is issued here and not when the request was queued, so no plaintext waits in the outbox.
    @Override
    public void compose(QueuedMessage message, Consumer<OutgoingMail> handOver) {
        MessageRecipient.required(accounts, message.accountId());
        IssuedResetCode issued = codes.issueFor(message.accountId());
        Locale locale = MessageLanguage.of(issued.recipientLocale(), club.defaultLocale());
        String key = MessageKind.ACCOUNT_PASSWORD_RESET_CODE.templateKey();
        Map<String, String> values = Map.of(
                "clubName", club.clubName(),
                "firstName", issued.recipientFirstName(),
                "username", issued.username(),
                "resetCode", issued.code(),
                "expiresAt", expiresAt(issued.expiresAt(), locale));
        handOver.accept(new OutgoingMail(issued.recipientAddress(),
                templates.render(key + ".subject", locale, values),
                templates.render(key + ".body", locale, values)));
    }

    // A time and not a date: a code that lives an hour expires on the day it was asked for.
    private String expiresAt(Instant expiresAt, Locale locale) {
        return DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT).withLocale(locale)
                .format(LocalDateTime.ofInstant(expiresAt, club.zoneId()));
    }
}
