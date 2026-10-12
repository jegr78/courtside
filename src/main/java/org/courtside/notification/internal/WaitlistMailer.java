package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubIdentity;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.notification.MessageKind;
import org.courtside.shared.WaitlistAnnouncer;
import org.courtside.shared.WaitlistOffered;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

@Component
@RequiredArgsConstructor
class WaitlistMailer implements MessageComposer {

    private final WaitlistAnnouncer waitlist;
    private final UserAccountRepository accounts;
    private final ClubIdentity club;
    private final MailTemplates templates;
    private final BookingWording wording;
    private final MessageOutbox outbox;

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT, fallbackExecution = true)
    void on(WaitlistOffered offered) {
        outbox.queue(offered.accountId(), MessageKind.WAITLIST_OFFER,
                Map.of(QueuedMessage.WAITLIST_ENTRY, offered.entryId().toString()));
    }

    @Override
    public Set<MessageKind> kinds() {
        return Set.of(MessageKind.WAITLIST_OFFER);
    }

    // An offer taken, declined or run out before its mail left needs no mail any more.
    @Override
    public void compose(QueuedMessage message, Consumer<OutgoingMail> handOver) {
        WaitlistAnnouncer.Offer offer = waitlist.describeOffer(message.waitlistEntry())
                .filter(WaitlistAnnouncer.Offer::open)
                .orElseThrow(() -> new MessageUndeliverableException("OfferEnded"));
        UserAccount account = MessageRecipient.required(accounts, message.accountId());
        Locale locale = MessageLanguage.of(account.getLocale(), club.defaultLocale());
        Map<String, String> values = new HashMap<>(wording.of(offer.slot(), locale));
        values.putAll(wording.deadline(offer.expiresAt(), locale));
        values.put("firstName", account.getPerson().getFirstName());
        String key = message.kind().templateKey();
        handOver.accept(new OutgoingMail(account.getPerson().getEmail(),
                templates.render(key + ".subject", locale, values),
                templates.render(key + ".body", locale, values)));
    }
}
