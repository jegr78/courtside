package org.courtside.shared.web;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AdmissionPlanTest {

    private static AdmissionPlan load(AdmissionProperties properties) {
        return AdmissionPlan.load(properties, JsonMapper.builder().build());
    }

    @Test
    void whenLoadingTheShippedPlan_thenEveryDemandingClassHasItsDecidedCostAndBulkhead() {
        // given
        Map<String, Optional<Integer>> concurrencyByOperation = Map.ofEntries(
                Map.entry("changeOwnPassword", Optional.empty()),
                Map.entry("executeImportPreview", Optional.of(1)),
                Map.entry("searchOperationalLogs", Optional.of(1)),
                Map.entry("createBooking", Optional.empty()),
                Map.entry("searchRoster", Optional.empty()),
                Map.entry("previewSeries", Optional.of(2)),
                Map.entry("exportBookings", Optional.of(2)),
                Map.entry("uploadClubLogo", Optional.of(1)),
                Map.entry("courtImpact", Optional.of(2)),
                Map.entry("endAllSessions", Optional.of(1)));
        Map<String, Integer> costByOperation = Map.of(
                "changeOwnPassword", 5, "executeImportPreview", 20, "searchOperationalLogs", 10,
                "createBooking", 2, "searchRoster", 2, "previewSeries", 10, "exportBookings", 20,
                "uploadClubLogo", 10, "courtImpact", 5, "endAllSessions", 5);

        // when
        AdmissionPlan plan = load(ShippedAdmission.defaults());

        // then
        costByOperation.forEach((operation, cost) -> assertThat(plan.of(operation).cost())
                .as("%s costs what its class decides", operation).isEqualTo(cost));
        concurrencyByOperation.forEach((operation, concurrency) -> assertThat(plan.of(operation).bulkhead().isPresent())
                .as("%s is bounded in parallel exactly when its class decides so", operation)
                .isEqualTo(concurrency.isPresent()));
        assertThat(plan.of("getBookingGrid").cost()).as("an ordinary operation costs one").isEqualTo(1);
        assertThat(plan.of("getBookingGrid").bulkhead()).isEmpty();
    }

    @Test
    void givenADemandingClassWithoutADecision_whenLoadingThePlan_thenTheInstanceRefusesToStart() {
        // given
        AdmissionProperties properties = ShippedAdmission.withClass(ShippedAdmission.defaults(), "roster-import", null);

        // when / then
        assertThatThrownBy(() -> load(properties))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("roster-import");
    }

    @Test
    void givenADecisionForNoClassification_whenLoadingThePlan_thenTheInstanceRefusesToStart() {
        // given
        AdmissionProperties properties = ShippedAdmission.withClass(ShippedAdmission.defaults(), "roster-imports",
                new AdmissionProperties.DemandClass(1, null));

        // when / then
        assertThatThrownBy(() -> load(properties))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("roster-imports");
    }

    @Test
    void givenADecisionForAClassNoRequestReaches_whenLoadingThePlan_thenTheInstanceRefusesToStart() {
        // given
        AdmissionProperties ordinary = ShippedAdmission.withClass(ShippedAdmission.defaults(), "ordinary-http",
                new AdmissionProperties.DemandClass(3, null));
        AdmissionProperties scheduled = ShippedAdmission.withClass(ShippedAdmission.defaults(), "scheduled-maintenance",
                new AdmissionProperties.DemandClass(3, 1));

        // when / then
        assertThatThrownBy(() -> load(ordinary)).as("an ordinary class always costs one")
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("ordinary-http");
        assertThatThrownBy(() -> load(scheduled)).as("a class without an HTTP operation is never admitted")
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("scheduled-maintenance");
    }

    @Test
    void givenACostAboveABudgetsBurst_whenLoadingThePlan_thenTheInstanceRefusesToStart() {
        // given
        AdmissionProperties properties = ShippedAdmission.withClass(ShippedAdmission.withAccountBurst(
                ShippedAdmission.defaults(), 15), "roster-import", new AdmissionProperties.DemandClass(20, 1));

        // when / then
        assertThatThrownBy(() -> load(properties))
                .as("an account burst of fifteen could never admit an import costing twenty")
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("courtside.admission.classes.roster-import.cost");
    }
}
