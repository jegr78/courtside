package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.courtside.config.ClubIdentity;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.notification.MessageKind;
import org.courtside.shared.BookingAnnouncement;
import org.courtside.shared.BookingAnnouncer;
import org.courtside.shared.BookingDisplaced;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

@Slf4j
@Component
@RequiredArgsConstructor
class DisplacementMailer {

    private final BookingAnnouncer bookings;
    private final UserAccountRepository accounts;
    private final ClubIdentity club;
    private final MailTemplates templates;
    private final BookingWording wording;
    private final RecordedHandover handover;

    @Async("bookingMailExecutor")
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    @TransactionalEventListener
    void on(BookingDisplaced displaced) {
        bookings.describe(displaced.bookingId()).ifPresent(booking ->
                everybodyIn(booking).forEach(account -> send(booking, account, displaced.closure())));
    }

    // The booker is a player of their own booking too, so one account is written to once.
    private List<UserAccount> everybodyIn(BookingAnnouncement booking) {
        Map<UUID, UserAccount> byAccount = new LinkedHashMap<>();
        accounts.findById(booking.bookedByAccountId())
                .ifPresent(account -> byAccount.put(account.getId(), account));
        if (!booking.playerPersonIds().isEmpty()) {
            accounts.findByPersonIdIn(booking.playerPersonIds())
                    .forEach(account -> byAccount.putIfAbsent(account.getId(), account));
        }
        return List.copyOf(byAccount.values());
    }

    private void send(BookingAnnouncement booking, UserAccount account,
                      BookingDisplaced.Closure closure) {
        String address = account.getPerson().getEmail();
        if (address == null || address.isBlank()) {
            log.info("Account {} has no address, so the closure notice stays unsent", account.getId());
            return;
        }
        Locale locale = MessageLanguage.of(account.getLocale(), club.defaultLocale());
        String key = MessageKind.BOOKING_DISPLACED.templateKey();
        Map<String, String> values = new HashMap<>(wording.of(booking, locale));
        values.put("firstName", account.getPerson().getFirstName());
        values.put("closure", templates.render(key + "." + closureKey(closure), locale, values));
        handover.handOver(account.getId(), MessageKind.BOOKING_DISPLACED, address,
                templates.render(key + ".subject", locale, values),
                templates.render(key + ".body", locale, values));
        log.info("Handed over a closure notice for account {}", account.getId());
    }

    private static String closureKey(BookingDisplaced.Closure closure) {
        return switch (closure) {
            case COURT_OUT_OF_SERVICE -> "court";
            case CARD_OUT_OF_SERVICE -> "card";
            case DAY_CLOSED -> "day";
        };
    }
}
