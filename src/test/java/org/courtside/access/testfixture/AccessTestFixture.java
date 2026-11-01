package org.courtside.access.testfixture;

import lombok.RequiredArgsConstructor;
import org.courtside.access.AccessGrantQuery;
import org.courtside.access.BookingAccessGrant;
import org.courtside.access.internal.AccessPasses;
import org.springframework.context.ApplicationContext;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;

@RequiredArgsConstructor
public class AccessTestFixture {

    private final ApplicationContext context;
    private final AccessGrantQuery grants;

    /** Runs one pass of the access worker, which installs every due grant on the connector. */
    public void installDueGrants() {
        AccessPasses.runNow(context);
    }

    /** Holds a dynamic code a door may accept until {@code until}, as a released code of an ended booking does. */
    public void holdReleasedCode(String code, Instant until) {
        context.getBean(JdbcClient.class).sql("INSERT INTO access_code (code, until) VALUES (:code, :until)")
                .param("code", code).param("until", Timestamp.from(until)).update();
    }

    public String installedCodeOf(UUID bookingId) {
        return grants.grantOf(bookingId).map(BookingAccessGrant::code)
                .orElseThrow(() -> new AssertionError("Booking " + bookingId + " holds no installed code"));
    }
}
