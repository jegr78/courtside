package org.courtside.access.internal;

import org.courtside.access.internal.ScriptedAccessControl.Kind;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

import java.time.Duration;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@ExtendWith(OutputCaptureExtension.class)
class AccessPassReconciliationTest extends AccessPassTestSupport {

    @Test
    void givenAListedGrantNoLongerWantedAndRemovedHere_whenReconciled_thenItIsRevokedAgain() {
        // given
        UUID booking = book(courts.get(0));
        UUID unlisted = book(courts.get(1));
        pass.runPassNow();
        cancel(booking);
        cancel(unlisted);
        passAt(START.plus(Duration.ofMinutes(1)));
        UUID grantId = grantIdOf(booking);
        assertThat(remoteOf(grantId)).as("the revoke has removed the grant here").isEqualTo("NONE");
        connector.lists(Set.of(grantId));

        // when
        passAt(START.plus(Duration.ofHours(2)));
        String marked = remoteOf(grantId);
        passAt(START.plus(Duration.ofHours(2).plusMinutes(1)));

        // then
        assertThat(marked).as("a user the system still lists may be installed").isEqualTo("MAYBE");
        assertThat(remoteOf(grantIdOf(unlisted))).as("a removed grant the system does not list stays removed")
                .isEqualTo("NONE");
        assertThat(connector.calls(Kind.REVOKE)).as("the next pass revokes only the listed one once more")
                .hasSize(3);
        assertThat(remoteOf(grantId)).isEqualTo("NONE");
    }

    @Test
    void givenAListedIdWithoutARow_whenReconciled_thenNothingIsCreatedOrRevoked() {
        // given
        UUID foreign = UUID.randomUUID();
        UUID booking = book(courts.get(0));
        pass.runPassNow();
        connector.lists(Set.of(foreign, grantIdOf(booking)));

        // when
        passAt(START.plus(Duration.ofHours(2)));
        passAt(START.plus(Duration.ofHours(2).plusMinutes(1)));

        // then
        assertThat(jdbc.sql("SELECT count(*) FROM access_grant WHERE id = ?").params(foreign).query(Integer.class)
                .single()).as("a user without a row belongs to another Courtside and stays alone").isZero();
        assertThat(connector.calls(Kind.REVOKE)).isEmpty();
        assertThat(connector.calls(Kind.GRANT)).as("a listed installed grant is not sent again").hasSize(1);
        assertThat(remoteOf(grantIdOf(booking))).isEqualTo("INSTALLED");
    }

    @Test
    void givenAnInstalledGrantTheSystemNoLongerLists_whenReconciled_thenItIsInstalledAgainWhileWanted() {
        // given
        UUID booking = book(courts.get(0));
        pass.runPassNow();
        connector.lists(Set.of());

        // when
        passAt(START.plus(Duration.ofHours(2)));
        String marked = remoteOf(grantIdOf(booking));
        passAt(START.plus(Duration.ofHours(2).plusMinutes(1)));

        // then
        assertThat(marked).as("a grant the system does not list is no longer known to be installed")
                .isEqualTo("MAYBE");
        assertThat(connector.calls(Kind.GRANT)).as("the next pass installs it again").hasSize(2);
        assertThat(remoteOf(grantIdOf(booking))).isEqualTo("INSTALLED");
    }

    @Test
    void givenAFailingListing_whenReconciled_thenNoRowChangesAndTheLogNamesTheFailureWithoutItsSecret(
            CapturedOutput output) {
        // given
        UUID booking = book(courts.get(0));
        pass.runPassNow();
        String before = rowOf(grantIdOf(booking));
        connector.failsListing(new IllegalStateException(
                "GET https://user:example-secret@miniserver.example.org/x?autht=example-token failed"));

        // when
        passAt(START.plus(Duration.ofHours(2)));

        // then
        assertThat(rowOf(grantIdOf(booking))).isEqualTo(before);
        assertThat(output.getOut()).as("the skipped step is logged with what failed")
                .contains("The access reconciliation was skipped")
                .contains("miniserver.example.org/x")
                .doesNotContain("example-secret").doesNotContain("example-token");
    }

    @Test
    void givenAListingConnector_whenPassesFollowWithinAnHour_thenItListsOnceAnHour() {
        // given
        UUID booking = book(courts.get(0));
        connector.lists(Set.of(UUID.randomUUID()));
        pass.runPassNow();
        connector.lists(Set.of(grantIdOf(booking)));

        // when
        passAt(START.plus(Duration.ofMinutes(30)));
        long withinTheHour = connector.calls(Kind.LIST).size();
        passAt(START.plus(Duration.ofMinutes(61)));

        // then
        assertThat(withinTheHour).as("the first pass lists, the next within the hour does not").isEqualTo(1);
        assertThat(connector.calls(Kind.LIST)).hasSize(2);
    }

    @Test
    void givenAConnectorThatCannotList_whenPassesRun_thenNoRowChanges() {
        // given
        UUID booking = book(courts.get(0));
        pass.runPassNow();
        String before = rowOf(grantIdOf(booking));

        // when
        passAt(START.plus(Duration.ofHours(2)));

        // then
        assertThat(connector.calls(Kind.LIST)).isEmpty();
        assertThat(rowOf(grantIdOf(booking))).isEqualTo(before);
    }

    private String remoteOf(UUID grantId) {
        return jdbc.sql("SELECT remote FROM access_grant WHERE id = ?").params(grantId).query(String.class).single();
    }

    private String rowOf(UUID grantId) {
        return jdbc.sql("SELECT remote || '|' || coalesce(next_attempt_at::text, '-') FROM access_grant WHERE id = ?")
                .params(grantId).query(String.class).single();
    }
}
