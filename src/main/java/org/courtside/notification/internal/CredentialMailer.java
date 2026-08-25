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

@Slf4j
@Component
@RequiredArgsConstructor
class CredentialMailer {

    private final CredentialIssuer credentials;
    private final CredentialValidity validity;
    private final ClubIdentity club;
    private final MailTemplates templates;
    private final RecordedHandover handover;
    private final Clock clock;

    @Async("credentialMailExecutor")
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    @TransactionalEventListener
    void on(CredentialsRequested requested) {
        Instant expiresAt = clock.instant().plus(validity.validFor(requested.reason()));
        IssuedCredential issued = credentials.issueFor(requested.accountId(), expiresAt);
        Locale locale = MessageLanguage.of(issued.recipientLocale(), club.defaultLocale());
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
        handover.handOver(requested.accountId(), kind, issued.recipientAddress(),
                templates.render(key + ".subject", locale, values),
                templates.render(key + ".body", locale, values));
        log.info("Handed over the {} message for account {}", requested.reason(), requested.accountId());
    }

    private String expiresOn(Instant expiresAt, Locale locale) {
        return DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG).withLocale(locale)
                .format(LocalDate.ofInstant(expiresAt, zone()));
    }

    private ZoneId zone() {
        return club.zoneId();
    }
}
