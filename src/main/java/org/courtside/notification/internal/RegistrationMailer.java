package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubIdentity;
import org.courtside.identity.UserAccountRepository;
import org.courtside.notification.MessageKind;
import org.courtside.shared.IssuedRegistrationCode;
import org.courtside.shared.RegistrationCodeIssuer;
import org.courtside.shared.RegistrationNameTaken;
import org.courtside.shared.RegistrationVerificationRequested;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.FormatStyle;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

@Component
@RequiredArgsConstructor
class RegistrationMailer implements MessageComposer {

    private static final String LANGUAGE = "language";

    private final UserAccountRepository accounts;
    private final RegistrationCodeIssuer codes;
    private final ClubIdentity club;
    private final MailTemplates templates;
    private final InstanceLinks links;
    private final MessageOutbox outbox;

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    void on(RegistrationVerificationRequested requested) {
        accounts.findById(requested.accountId()).ifPresent(account -> outbox.queueToAddress(account.getId(),
                MessageKind.REGISTRATION_VERIFICATION, account.getPerson().getEmail(), Map.of()));
    }

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    void on(RegistrationNameTaken taken) {
        outbox.queueToAddress(taken.holderAccountId(), MessageKind.REGISTRATION_NAME_TAKEN, taken.submittedAddress(),
                Map.of(LANGUAGE, taken.language()));
    }

    @Override
    public Set<MessageKind> kinds() {
        return Set.of(MessageKind.REGISTRATION_VERIFICATION, MessageKind.REGISTRATION_NAME_TAKEN);
    }

    // The code is issued here and not when the registration was queued, so no plaintext waits in the outbox.
    @Override
    public void compose(QueuedMessage message, Consumer<OutgoingMail> handOver) {
        if (message.kind() == MessageKind.REGISTRATION_NAME_TAKEN) {
            composeNameTaken(message, handOver);
            return;
        }
        IssuedRegistrationCode issued = codes.issueFor(message.accountId())
                .orElseThrow(() -> new MessageUndeliverableException("RegistrationSettled"));
        Locale locale = MessageLanguage.of(issued.recipientLocale(), club.defaultLocale());
        String key = MessageKind.REGISTRATION_VERIFICATION.templateKey();
        Map<String, String> values = Map.of(
                "clubName", club.clubName(),
                "verificationLink", links.root() + "registration/verify#" + issued.code(),
                "expiresAt", DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT).withLocale(locale)
                        .format(LocalDateTime.ofInstant(issued.expiresAt(), club.zoneId())),
                InstanceLinks.PLACEHOLDER, links.root());
        handOver.accept(new OutgoingMail(issued.recipientAddress(),
                templates.render(key + ".subject", locale, values), templates.render(key + ".body", locale, values)));
    }

    private void composeNameTaken(QueuedMessage message, Consumer<OutgoingMail> handOver) {
        String address = message.previousAddress();
        if (address == null || address.isBlank()) {
            throw new MessageUndeliverableException("ParameterMissing");
        }
        Locale locale = MessageLanguage.of(message.parameters().get(LANGUAGE), club.defaultLocale());
        String key = MessageKind.REGISTRATION_NAME_TAKEN.templateKey();
        Map<String, String> values = Map.of("clubName", club.clubName(), InstanceLinks.PLACEHOLDER, links.of(message));
        handOver.accept(new OutgoingMail(address,
                templates.render(key + ".subject", locale, values), templates.render(key + ".body", locale, values)));
    }
}
