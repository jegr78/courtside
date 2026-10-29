package org.courtside.access.internal;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class AccessGrantMappingTest extends AbstractIntegrationTest {

    private static final UUID NORTH_GATE = UUID.fromString("70300000-0000-0000-0000-000000000001");
    private static final UUID SOUTH_GATE = UUID.fromString("70300000-0000-0000-0000-000000000002");

    @Autowired
    private AccessGrantRepository grants;

    @Autowired
    private AccessCodeRepository codes;

    @Autowired
    private JdbcClient jdbc;

    @Test
    void givenAStoredGrantAndItsCode_whenTheyAreRead_thenEveryColumnArrivesInItsField() {
        // given
        UUID grantId = UUID.randomUUID();
        UUID bookingId = UUID.randomUUID();
        jdbc.sql("""
                        INSERT INTO access_grant (id, booking_id, wanted, want_from, want_until, want_points,
                                                  want_mapping, remote, remote_points, exposed_until, attempts)
                        VALUES (:id, :booking, true, '2026-05-12T08:45:00Z', '2026-05-12T10:15:00Z',
                                ARRAY[:north, :south]::uuid[], 'groups-1', 'MAYBE', ARRAY[:north]::uuid[],
                                '2026-05-12T10:15:00Z', 2)
                        """)
                .param("id", grantId).param("booking", bookingId).param("north", NORTH_GATE)
                .param("south", SOUTH_GATE).update();
        jdbc.sql("INSERT INTO access_code (code, grant_id) VALUES ('482915', ?)").params(grantId).update();

        // when
        AccessGrant grant = grants.findById(grantId).orElseThrow();
        AccessCode code = codes.findById("482915").orElseThrow();

        // then
        assertThat(grant.getBookingId()).isEqualTo(bookingId);
        assertThat(grant.isWanted()).isTrue();
        assertThat(grant.getWantUntil()).isEqualTo(Instant.parse("2026-05-12T10:15:00Z"));
        assertThat(grant.getWantPoints()).containsExactlyInAnyOrder(NORTH_GATE, SOUTH_GATE);
        assertThat(grant.getWantMapping()).isEqualTo("groups-1");
        assertThat(grant.getRemote()).isEqualTo(RemoteState.MAYBE);
        assertThat(grant.getRemotePoints()).containsExactly(NORTH_GATE);
        assertThat(grant.getRemoteFrom()).as("never installed for sure").isNull();
        assertThat(grant.getAttempts()).isEqualTo(2);
        assertThat(grant.isRefused()).isFalse();
        assertThat(code.getGrantId()).isEqualTo(grantId);
        assertThat(code.getUntil()).isNull();
    }
}
