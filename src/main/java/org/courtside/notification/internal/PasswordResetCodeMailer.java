package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubIdentity;
import org.courtside.notification.MessageKind;
import org.courtside.shared.IssuedResetCode;
import org.courtside.shared.PasswordResetCodeIssuer;
import org.courtside.shared.PasswordResetRequested;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.FormatStyle;
import java.util.Locale;
import java.util.Map;

@Component
@RequiredArgsConstructor
class PasswordResetCodeMailer {

    private final PasswordResetCodeIssuer codes;
    private final ClubIdentity club;
    private final MailTemplates templates;
    private final RecordedHandover handover;

    @Async("credentialMailExecutor")
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    @TransactionalEventListener
    void on(PasswordResetRequested requested) {
        IssuedResetCode issued = codes.issueFor(requested.accountId());
        Locale locale = MessageLanguage.of(issued.recipientLocale(), club.defaultLocale());
        String key = MessageKind.ACCOUNT_PASSWORD_RESET_CODE.templateKey();
        Map<String, String> values = Map.of(
                "clubName", club.clubName(),
                "firstName", issued.recipientFirstName(),
                "username", issued.username(),
                "code", issued.code(),
                "expiresAt", expiresAt(issued.expiresAt(), locale));
        handover.handOver(requested.accountId(), MessageKind.ACCOUNT_PASSWORD_RESET_CODE,
                issued.recipientAddress(),
                templates.render(key + ".subject", locale, values),
                templates.render(key + ".body", locale, values));
    }

    // A time and not a date: a code that lives an hour expires on the day it was asked for.
    private String expiresAt(Instant expiresAt, Locale locale) {
        return DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT).withLocale(locale)
                .format(LocalDateTime.ofInstant(expiresAt, club.zoneId()));
    }
}
