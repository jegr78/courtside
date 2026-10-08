package org.courtside.shared.web;

import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.core.io.ClassPathResource;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AdmissionPlanTest {

    private static AdmissionProperties shippedDefaults() throws IOException {
        StandardEnvironment environment = new StandardEnvironment();
        new YamlPropertySourceLoader().load("application", new ClassPathResource("application.yaml"))
                .forEach(environment.getPropertySources()::addLast);
        return Binder.get(environment).bind("courtside.admission", AdmissionProperties.class).get();
    }

    private static AdmissionProperties without(AdmissionProperties properties, String demandClass) {
        Map<String, AdmissionProperties.DemandClass> classes = new HashMap<>(properties.classes());
        classes.remove(demandClass);
        return new AdmissionProperties(properties.account(), properties.address(), properties.trackedPrincipals(),
                classes);
    }

    private static AdmissionProperties with(AdmissionProperties properties, String demandClass,
                                            AdmissionProperties.DemandClass decision) {
        Map<String, AdmissionProperties.DemandClass> classes = new HashMap<>(properties.classes());
        classes.put(demandClass, decision);
        return new AdmissionProperties(properties.account(), properties.address(), properties.trackedPrincipals(),
                classes);
    }

    @Test
    void givenTheShippedDefaults_whenLoadingThePlan_thenOperationsTakeTheirInventoryClass() throws IOException {
        // when
        AdmissionPlan plan = AdmissionPlan.load(shippedDefaults(), JsonMapper.builder().build());

        // then
        assertThat(plan.of("previewSeries").demandClass()).isEqualTo("booking-series");
        assertThat(plan.of("previewSeries").cost()).isEqualTo(10);
        assertThat(plan.of("previewSeries").bulkhead()).as("series work is bounded in parallel").isPresent();
        assertThat(plan.of("createBooking").cost()).isEqualTo(2);
        assertThat(plan.of("createBooking").bulkhead())
                .as("booking writes are bounded by their cost and their locks, not by refusing a busy morning")
                .isEmpty();
        assertThat(plan.of("getBookingGrid").cost()).as("an ordinary operation costs one").isEqualTo(1);
    }

    @Test
    void givenADemandingClassWithoutADecision_whenLoadingThePlan_thenTheInstanceRefusesToStart() throws IOException {
        // given
        AdmissionProperties properties = without(shippedDefaults(), "roster-import");

        // when / then
        assertThatThrownBy(() -> AdmissionPlan.load(properties, JsonMapper.builder().build()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("roster-import");
    }

    @Test
    void givenADecisionForNoClassification_whenLoadingThePlan_thenTheInstanceRefusesToStart() throws IOException {
        // given
        AdmissionProperties properties = with(shippedDefaults(), "roster-imports",
                new AdmissionProperties.DemandClass(1, null));

        // when / then
        assertThatThrownBy(() -> AdmissionPlan.load(properties, JsonMapper.builder().build()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("roster-imports");
    }

    @Test
    void givenACostNoBurstCanHold_whenLoadingThePlan_thenTheInstanceRefusesToStart() throws IOException {
        // given
        AdmissionProperties properties = with(shippedDefaults(), "roster-import",
                new AdmissionProperties.DemandClass(10_000, 1));

        // when / then
        assertThatThrownBy(() -> AdmissionPlan.load(properties, JsonMapper.builder().build()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("courtside.admission.classes.roster-import.cost");
    }
}
