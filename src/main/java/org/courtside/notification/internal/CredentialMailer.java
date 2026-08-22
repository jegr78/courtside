package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.courtside.config.ClubIdentity;
import org.courtside.config.CredentialValidity;
import org.courtside.shared.CredentialIssuer;
import org.courtside.shared.CredentialsRequested;
import org.courtside.shared.IssuedCredential;
import org.springframework.modulith.events.ApplicationModuleListener;
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
    private final MailDispatch dispatch;
    private final MailHandover handover;
    private final MailProperties properties;
    private final Clock clock;

    @ApplicationModuleListener
    void on(CredentialsRequested requested) {
        Instant expiresAt = clock.instant().plus(validity.validFor(requested.reason()));
        IssuedCredential issued = credentials.issueFor(requested.accountId(), expiresAt);
        Locale locale = localeOf(issued);
        String key = requested.reason() == CredentialsRequested.Reason.NEW_ACCOUNT
                ? "credentials.newAccount"
                : "credentials.passwordReset";
        Map<String, String> values = Map.of(
                "clubName", club.clubName(),
                "firstName", issued.recipientFirstName(),
                "username", issued.username(),
                "credential", issued.credential(),
                "expiresOn", expiresOn(expiresAt, locale));
        String messageId = MailDispatch.newMessageId(senderDomain());
        String subject = templates.render(key + ".subject", locale, values);
        String body = templates.render(key + ".body", locale, values);
        handover.attempt(messageId, () -> dispatch.send(issued.recipientAddress(), subject, body, messageId));
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

    private String senderDomain() {
        String from = properties.from();
        return from.substring(from.indexOf('@') + 1);
    }
}
