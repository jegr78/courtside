package org.courtside.booking.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.booking.BookingRepository;
import org.courtside.identity.Outsiders;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.member.MemberService;
import org.courtside.shared.DoorCodeAudience;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Component
@RequiredArgsConstructor
class BookedDoorCodeAudience implements DoorCodeAudience {

    private final MemberService members;
    private final Outsiders outsiders;
    private final UserAccountRepository accounts;
    private final BookingRepository bookings;
    private final AccessGrants grants;
    private final Clock clock;

    @Override
    @Transactional(readOnly = true)
    public boolean includes(UUID accountId) {
        if (accountId == null) {
            return false;
        }
        if (members.isCurrentMember(accountId)) {
            return true;
        }
        return accounts.findById(accountId)
                .filter(UserAccount::isEnabled)
                .filter(account -> outsiders.isOutsider(accountId, account.getRoles()))
                .isPresent()
                && bookings.existsOpeningDoorsBookedBy(accountId, windowsEndingAfter());
    }

    @Override
    @Transactional(readOnly = true)
    public List<UUID> bookersAfter(UUID after, int limit) {
        return bookings.findBookersOpeningDoorsAfter(windowsEndingAfter(), after, limit);
    }

    private Instant windowsEndingAfter() {
        return clock.instant().minus(grants.accessLag());
    }
}
