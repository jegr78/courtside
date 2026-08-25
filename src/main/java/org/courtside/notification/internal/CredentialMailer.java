package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.courtside.config.ClubIdentity;
import org.courtside.config.CredentialValidity;
import org.courtside.notification.MessageKind;
import org.courtside.shared.CredentialIssuer;
import org.courtside.shared.CredentialsRequested;
import org.courtside.shared.IssuedCredential;
import org.springframework.scheduling.annotation.Async;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.FormatStyle;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

@Slf4j
@Component
@RequiredArgsConstructor
class CredentialMailer {

    private final CredentialIssuer credentials;
    private final CredentialValidity validity;
    private final ClubIdentity club;
    private final MailTemplates templates;
    private final MailDispatch dispatch;
    private final MailHandover handover;
    private final MailProperties properties;
    private final MessageLog messages;
    private final Clock clock;

    @Async("outboundMailExecutor")
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    @TransactionalEventListener
    void on(CredentialsRequested requested) {
        Instant expiresAt = clock.instant().plus(validity.validFor(requested.reason()));
        IssuedCredential issued = credentials.issueFor(requested.accountId(), expiresAt);
        Locale locale = localeOf(issued);
        MessageKind kind = requested.reason() == CredentialsRequested.Reason.NEW_ACCOUNT
                ? MessageKind.CREDENTIALS_NEW_ACCOUNT
                : MessageKind.CREDENTIALS_PASSWORD_RESET;
        String key = kind.templateKey();
        Map<String, String> values = Map.of(
                "clubName", club.clubName(),
                "firstName", issued.recipientFirstName(),
                "username", issued.username(),
                "credential", issued.credential(),
                "expiresOn", expiresOn(expiresAt, locale));
        String messageId = MailDispatch.newMessageId(senderDomain());
        String subject = templates.render(key + ".subject", locale, values);
        String body = templates.render(key + ".body", locale, values);
        UUID record = messages.queued(requested.accountId(), kind, messageId);
        try {
            handover.attempt(messageId,
                    () -> dispatch.send(issued.recipientAddress(), subject, body, messageId));
        } catch (MailRecipientRefusedException refusal) {
            messages.refused(record, refusal.diagnosis(), refusal.statusCode());
            throw refusal;
        } catch (RuntimeException failure) {
            messages.failed(record, diagnosisOf(failure));
            throw failure;
        }
        messages.handedOver(record);
        log.info("Handed over the {} message for account {}", requested.reason(), requested.accountId());
    }

    private Locale localeOf(IssuedCredential issued) {
        String tag = issued.recipientLocale() == null || issued.recipientLocale().isBlank()
                ? club.defaultLocale()
                : issued.recipientLocale();
        return Locale.forLanguageTag(tag);
    }

    private String expiresOn(Instant expiresAt, Locale locale) {
        return DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG).withLocale(locale)
                .format(LocalDate.ofInstant(expiresAt, zone()));
    }

    private ZoneId zone() {
        return club.zoneId();
    }

    // Every escape, not a list of types: an exception this method does not know about would
    // otherwise leave the row on queued, which is the one thing this log exists to prevent.
    private static String diagnosisOf(RuntimeException failure) {
        return failure instanceof MailHandoverFailedException handover
                ? handover.diagnosis()
                : failure.getClass().getSimpleName();
    }

    private String senderDomain() {
        String from = properties.from();
        return from.substring(from.indexOf('@') + 1);
    }
}
