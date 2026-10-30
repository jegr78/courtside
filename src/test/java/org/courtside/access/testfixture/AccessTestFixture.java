package org.courtside.access.testfixture;

import lombok.RequiredArgsConstructor;
import org.courtside.access.AccessGrantQuery;
import org.courtside.access.BookingAccessGrant;
import org.courtside.access.internal.AccessPasses;
import org.springframework.context.ApplicationContext;

import java.util.UUID;

@RequiredArgsConstructor
public class AccessTestFixture {

    private final ApplicationContext context;
    private final AccessGrantQuery grants;

    /** Runs one pass of the access worker, which installs every due grant on the connector. */
    public void installDueGrants() {
        AccessPasses.runNow(context);
    }

    public String installedCodeOf(UUID bookingId) {
        return grants.grantOf(bookingId).map(BookingAccessGrant::code)
                .orElseThrow(() -> new AssertionError("Booking " + bookingId + " holds no installed code"));
    }
}
