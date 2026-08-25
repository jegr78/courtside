package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.courtside.config.ClubIdentity;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.notification.MessageKind;
import org.courtside.shared.BookingAnnouncement;
import org.courtside.shared.BookingAnnouncer;
import org.courtside.shared.BookingConfirmed;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.FormatStyle;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

@Slf4j
@Component
@RequiredArgsConstructor
class BookingMailer {

    private final BookingAnnouncer bookings;
    private final UserAccountRepository accounts;
    private final ClubIdentity club;
    private final MailTemplates templates;
    private final RecordedHandover handover;

    @Async("bookingMailExecutor")
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    @TransactionalEventListener
    void on(BookingConfirmed confirmed) {
        Optional<BookingAnnouncement> announced = bookings.describe(confirmed.bookingId());
        if (announced.isEmpty()) {
            log.warn("Booking {} was confirmed but describes nothing to send", confirmed.bookingId());
            return;
        }
        BookingAnnouncement booking = announced.get();
        UserAccount account = accounts.findById(booking.bookedByAccountId()).orElse(null);
        String address = account == null ? null : account.getPerson().getEmail();
        if (address == null || address.isBlank()) {
            log.info("Account {} has no address, so its booking confirmation stays unsent",
                    booking.bookedByAccountId());
            return;
        }
        send(booking, account, address);
    }

    private void send(BookingAnnouncement booking, UserAccount account, String address) {
        Locale locale = MessageLanguage.of(account.getLocale(), club.defaultLocale());
        String key = MessageKind.BOOKING_CONFIRMED.templateKey();
        Map<String, String> values = Map.of(
                "clubName", club.clubName(),
                "firstName", account.getPerson().getFirstName(),
                "day", day(booking.startsAt(), locale),
                "from", time(booking.startsAt()),
                "to", time(booking.endsAt()),
                "courts", courts(booking, locale),
                "card", booking.cardLabel());
        handover.handOver(account.getId(), MessageKind.BOOKING_CONFIRMED, address,
                templates.render(key + ".subject", locale, values),
                templates.render(key + ".body", locale, values));
        log.info("Handed over the booking confirmation for account {}", account.getId());
    }

    private String courts(BookingAnnouncement booking, Locale locale) {
        return booking.courts().stream()
                .map(court -> court.name() == null || court.name().isBlank()
                        ? templates.render("booking.court", locale,
                                Map.of("number", String.valueOf(court.number())))
                        : court.name())
                .collect(Collectors.joining(", "));
    }

    private String day(Instant startsAt, Locale locale) {
        return DateTimeFormatter.ofLocalizedDate(FormatStyle.FULL).withLocale(locale)
                .format(ZonedDateTime.ofInstant(startsAt, zone()));
    }

    private String time(Instant instant) {
        return DateTimeFormatter.ofPattern("HH:mm").format(ZonedDateTime.ofInstant(instant, zone()));
    }

    private ZoneId zone() {
        return club.zoneId();
    }
}
