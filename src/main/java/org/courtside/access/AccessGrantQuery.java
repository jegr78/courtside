package org.courtside.access;

import java.util.Optional;
import java.util.UUID;

public interface AccessGrantQuery {

    Optional<BookingAccessGrant> grantOf(UUID bookingId);
}
