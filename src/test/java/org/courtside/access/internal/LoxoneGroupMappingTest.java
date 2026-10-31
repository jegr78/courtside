package org.courtside.access.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.time.ZoneId;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Import(FacilityTestFixture.class)
class LoxoneGroupMappingTest extends AbstractIntegrationTest {

    private static final String GROUP = "0f1e2d3c-4b5a-6978-8796a5b4c3d2e1f0";
    private static final String OTHER_GROUP = "1a2b3c4d-5e6f-7081-92a3b4c5d6e7f809";

    @Autowired
    private AccessPointLoxoneGroups groups;

    @Autowired
    private FacilityTestFixture facility;

    @Test
    void givenAMappedAccessPoint_whenTheBoardChangesItsGroup_thenTheConnectorsMappingFollows() {
        // given
        UUID gate = facility.createAccessPointWithLoxoneGroup("North gate", GROUP);
        LoxoneAccessControl connector = new LoxoneAccessControl(new LoxoneSettings(
                new LoxoneAddress.Fixed(URI.create("https://miniserver.example.org")), "courtside",
                "example-password", () -> ZoneId.of("Europe/Berlin"), Duration.ofSeconds(1)), groups,
                LoxoneSimulator.clientTrust(), Clock.systemUTC());
        String before = connector.mappingOf(Set.of(gate));

        // when
        facility.mapLoxoneGroup(gate, OTHER_GROUP);
        String after = connector.mappingOf(Set.of(gate));
        facility.mapLoxoneGroup(gate, null);
        String unmapped = connector.mappingOf(Set.of(gate));
        connector.close();

        // then
        assertThat(groups.groupOf(UUID.randomUUID())).isEmpty();
        assertThat(before).contains(GROUP);
        assertThat(after).as("a changed group is a changed mapping, so the pass installs the grant again")
                .contains(OTHER_GROUP).isNotEqualTo(before);
        assertThat(unmapped).isNotEqualTo(after).doesNotContain(OTHER_GROUP);
        assertThat(List.of(before, after, unmapped)).doesNotHaveDuplicates();
    }
}
