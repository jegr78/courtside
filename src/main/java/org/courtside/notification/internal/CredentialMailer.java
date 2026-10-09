package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubIdentity;
import org.courtside.config.CredentialValidity;
import org.courtside.identity.UserAccountRepository;
import org.courtside.notification.MessageKind;
import org.courtside.shared.CredentialIssuer;
import org.courtside.shared.CredentialsRequested;
import org.courtside.shared.IssuedCredential;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.FormatStyle;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;

// The queued row names the account and nothing else: the credential is generated when the message
// is written, so no plaintext waits in the outbox.
@Component
@RequiredArgsConstructor
class CredentialMailer implements MessageComposer {

    private final CredentialIssuer credentials;
    private final CredentialValidity validity;
    private final UserAccountRepository accounts;
    private final ClubIdentity club;
    private final MailTemplates templates;
    private final MessageOutbox outbox;
    private final JdbcClient jdbc;
    private final Clock clock;

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT, fallbackExecution = true)
    void on(CredentialsRequested requested) {
        outbox.queue(requested.accountId(), requested.reason() == CredentialsRequested.Reason.NEW_ACCOUNT
                ? MessageKind.CREDENTIALS_NEW_ACCOUNT
                : MessageKind.CREDENTIALS_PASSWORD_RESET, Map.of());
    }

    @Override
    public Set<MessageKind> kinds() {
        return Set.of(MessageKind.CREDENTIALS_NEW_ACCOUNT, MessageKind.CREDENTIALS_PASSWORD_RESET);
    }

    @Override
    public void compose(QueuedMessage message, Consumer<OutgoingMail> handOver) {
        boolean addressed = accounts.findById(message.accountId())
                .map(account -> account.getPerson().getEmail())
                .filter(address -> !address.isBlank())
                .isPresent();
        if (!addressed) {
            throw new MessageUndeliverableException("RecipientUnreachable");
        }
        CredentialsRequested.Reason reason = message.kind() == MessageKind.CREDENTIALS_NEW_ACCOUNT
                ? CredentialsRequested.Reason.NEW_ACCOUNT
                : CredentialsRequested.Reason.PASSWORD_RESET;
        holdTheAccountsCredentialMail(message.accountId());
        Instant expiresAt = clock.instant().plus(validity.validFor(reason));
        credentials.issueFor(message.accountId(), expiresAt,
                issued -> handOver.accept(write(message.kind(), issued, expiresAt)));
    }

    // Held until the handover commits, so the credential mailed last is always the one stored last.
    private void holdTheAccountsCredentialMail(UUID accountId) {
        jdbc.sql("SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))) lock")
                .param("key", "credential-mail:" + accountId)
                .query(Integer.class)
                .single();
    }

    private OutgoingMail write(MessageKind kind, IssuedCredential issued, Instant expiresAt) {
        Locale locale = MessageLanguage.of(issued.recipientLocale(), club.defaultLocale());
        String key = kind.templateKey();
        Map<String, String> values = Map.of(
                "clubName", club.clubName(),
                "firstName", issued.recipientFirstName(),
                "username", issued.username(),
                "credential", issued.credential(),
                "expiresOn", expiresOn(expiresAt, locale));
        return new OutgoingMail(issued.recipientAddress(),
                templates.render(key + ".subject", locale, values),
                templates.render(key + ".body", locale, values));
    }

    private String expiresOn(Instant expiresAt, Locale locale) {
        return DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG).withLocale(locale)
                .format(LocalDate.ofInstant(expiresAt, club.zoneId()));
    }
}
