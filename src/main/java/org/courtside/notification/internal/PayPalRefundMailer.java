package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.courtside.config.ClubIdentity;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.notification.MessageKind;
import org.courtside.payment.PaymentEvent;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

@Slf4j
@Component
@RequiredArgsConstructor
class PayPalRefundMailer implements MessageComposer {

    private static final String AMOUNT = "amountMinor";
    private static final String CURRENCY = "currency";

    private final UserAccountRepository accounts;
    private final ClubIdentity club;
    private final MailTemplates templates;
    private final InstanceLinks links;
    private final MessageOutbox outbox;

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT, fallbackExecution = true)
    void on(PaymentEvent.PayPalRefunded refunded) {
        if (refunded.anonymised()) {
            log.info("Account {} is anonymised and is not told of the refund of booking {}",
                    refunded.accountId(), refunded.bookingId());
            return;
        }
        outbox.queue(refunded.accountId(), MessageKind.PAYPAL_REFUNDED, Map.of(
                QueuedMessage.BOOKING, refunded.bookingId().toString(),
                AMOUNT, Integer.toString(refunded.amountMinor()),
                CURRENCY, refunded.currency()));
    }

    @Override
    public Set<MessageKind> kinds() {
        return Set.of(MessageKind.PAYPAL_REFUNDED);
    }

    @Override
    public void compose(QueuedMessage message, Consumer<OutgoingMail> handOver) {
        UserAccount account = MessageRecipient.required(accounts, message.accountId());
        Locale locale = MessageLanguage.of(account.getLocale(), club.defaultLocale());
        String amount = BookingWording.money(Integer.parseInt(message.parameters().get(AMOUNT)),
                message.parameters().get(CURRENCY), locale);
        Map<String, String> values = Map.of(
                "clubName", club.clubName(),
                "firstName", account.getPerson().getFirstName(),
                "amount", amount,
                InstanceLinks.PLACEHOLDER, links.of(message));
        String key = message.kind().templateKey();
        handOver.accept(new OutgoingMail(account.getPerson().getEmail(),
                templates.render(key + ".subject", locale, values),
                templates.render(key + ".body", locale, values)));
    }
}
