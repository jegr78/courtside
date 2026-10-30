package org.courtside.access.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.access.AccessControlConnector;
import org.courtside.access.AccessGrantQuery;
import org.courtside.access.BookingAccessGrant;
import org.courtside.shared.IssuedAccessCodes;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;
import java.util.UUID;

@Component
@RequiredArgsConstructor
class AccessGrantLookup implements AccessGrantQuery, IssuedAccessCodes {

    private final AccessGrantRepository grants;
    private final AccessCodes codes;
    private final ObjectProvider<AccessControlConnector> connector;

    @Override
    @Transactional(readOnly = true)
    public Optional<BookingAccessGrant> grantOf(UUID bookingId) {
        return grants.findByBookingId(bookingId).map(grant -> new BookingAccessGrant(grant.status(),
                grant.getFirstAcceptedAt() != null && grant.isWanted()
                        ? codes.currentCode(grant.getId()).orElse(null) : null,
                grant.getWantFrom(), grant.getWantUntil()));
    }

    @Override
    public boolean issuesCodes() {
        return connector.getIfAvailable() != null;
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<String> codeOf(UUID bookingId) {
        return grantOf(bookingId).map(BookingAccessGrant::code);
    }
}
