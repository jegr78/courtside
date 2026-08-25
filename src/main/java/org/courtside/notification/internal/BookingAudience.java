package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.shared.BookingAnnouncement;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Component
@RequiredArgsConstructor
class BookingAudience {

    private final UserAccountRepository accounts;

    // The booker is a player of their own booking too, so one account is written to once.
    List<UserAccount> of(BookingAnnouncement booking) {
        Map<UUID, UserAccount> byAccount = new LinkedHashMap<>();
        MessageRecipient.reachable(accounts.findById(booking.bookedByAccountId()))
                .ifPresent(account -> byAccount.put(account.getId(), account));
        if (!booking.playerPersonIds().isEmpty()) {
            accounts.findByPersonIdIn(booking.playerPersonIds()).stream()
                    .filter(account -> MessageRecipient.reachable(Optional.of(account)).isPresent())
                    .forEach(account -> byAccount.putIfAbsent(account.getId(), account));
        }
        return List.copyOf(byAccount.values());
    }
}
