package org.courtside.facility;

import org.courtside.AbstractIntegrationTest;
import org.courtside.audit.testfixture.AuditTestFixture;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Import(AuditTestFixture.class)
class AccessPointLoxoneGroupTest extends AbstractIntegrationTest {

    private static final String GROUP = "0f1e2d3c-4b5a-6978-8796a5b4c3d2e1f0";
    private static final String OTHER_GROUP = "1a2b3c4d-5e6f-7081-92a3b4c5d6e7f809";

    @Autowired
    private FacilityService facility;

    @Autowired
    private AuditTestFixture audit;

    @Test
    void givenAMalformedLoxoneGroup_whenTheServiceStoresIt_thenItRefusesItByCode() {
        // when / then
        assertThatThrownBy(() -> facility.createAccessPoint("North gate", List.of(), null, null, false, "group-one"))
                .isInstanceOf(AccessPointRejectedException.class)
                .extracting("code").isEqualTo("facility.accessPoint.loxoneGroupMalformed");
        assertThat(facility.allAccessPoints()).isEmpty();
    }

    @Test
    void givenAMappedAccessPoint_whenItsGroupChanges_thenTheLogNamesTheFieldAndTheGroupIsRead() {
        // given
        UUID gate = facility.createAccessPoint("North gate", List.of(), null, null, false, GROUP).getId();

        // when
        facility.changeAccessPoint(gate, "North gate", List.of(), null, null, false, OTHER_GROUP);

        // then
        assertThat(audit.latestPayload(gate, FacilityEvent.AccessPointChanged.TYPE))
                .containsEntry("changedFields", List.of("loxoneGroup"));
        assertThat(facility.loxoneGroupOf(gate)).contains(OTHER_GROUP);
    }

    @Test
    void givenAMappedAccessPoint_whenAChangeLeavesTheGroupOut_thenTheGroupStays() {
        // given
        UUID gate = facility.createAccessPoint("North gate", List.of(), null, null, false, GROUP).getId();

        // when
        facility.changeAccessPoint(gate, "South gate", List.of(), null, null, false);

        // then
        assertThat(facility.loxoneGroupOf(gate)).as("a caller that does not know about groups keeps the mapping")
                .contains(GROUP);
        assertThat(facility.loxoneGroupOf(UUID.randomUUID())).isEmpty();
    }
}
