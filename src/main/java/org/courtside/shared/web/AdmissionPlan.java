package org.courtside.shared.web;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;

final class AdmissionPlan {

    static final String INVENTORY = "/admission/resource-demand-inventory.json";

    private static final Admission ORDINARY = new Admission("ordinary", 1, Optional.empty());

    private final Map<String, Admission> byOperation;

    private AdmissionPlan(Map<String, Admission> byOperation) {
        this.byOperation = Map.copyOf(byOperation);
    }

    Admission of(String operationId) {
        return byOperation.getOrDefault(operationId, ORDINARY);
    }

    static AdmissionPlan load(AdmissionProperties properties, ObjectMapper json) {
        try (InputStream source = AdmissionPlan.class.getResourceAsStream(INVENTORY)) {
            if (source == null) {
                throw new IllegalStateException("The resource demand inventory is missing from " + INVENTORY);
            }
            return from(json.readTree(source), properties);
        } catch (IOException | JacksonException failure) {
            throw new IllegalStateException("The resource demand inventory cannot be read", failure);
        }
    }

    static AdmissionPlan from(JsonNode inventory, AdmissionProperties properties) {
        int smallestBurst = Math.min(properties.account().burst(), properties.address().burst());
        Set<String> known = new TreeSet<>();
        Set<String> undecided = new TreeSet<>();
        Map<String, Admission> byOperation = new HashMap<>();
        Set<String> admissible = new TreeSet<>();
        for (JsonNode classification : required(inventory, "classifications")) {
            String id = required(classification, "id").asString();
            known.add(id);
            if (!"demanding".equals(required(classification, "kind").asString())) {
                continue;
            }
            Set<String> operations = new TreeSet<>();
            required(classification, "entryPoints").forEach(entry -> {
                if (!entry.asString().contains("#")) {
                    operations.add(entry.asString());
                }
            });
            if (operations.isEmpty()) {
                continue;
            }
            admissible.add(id);
            AdmissionProperties.DemandClass decided = properties.classes().get(id);
            if (decided == null) {
                undecided.add(id);
                continue;
            }
            if (decided.cost() > smallestBurst) {
                throw new IllegalStateException("courtside.admission.classes." + id
                        + ".cost exceeds the burst of a request budget, so that budget could never admit it");
            }
            Admission admission = new Admission(id, decided.cost(),
                    Optional.ofNullable(decided.concurrency()).map(Bulkhead::new));
            operations.forEach(operation -> byOperation.put(operation, admission));
        }
        if (!undecided.isEmpty()) {
            throw new IllegalStateException("Demanding operations have no admission decision under "
                    + "courtside.admission.classes: " + undecided);
        }
        Set<String> unknown = new TreeSet<>(properties.classes().keySet());
        unknown.removeAll(known);
        if (!unknown.isEmpty()) {
            throw new IllegalStateException("courtside.admission.classes names no inventory classification: "
                    + unknown);
        }
        Set<String> ineffective = new TreeSet<>(properties.classes().keySet());
        ineffective.removeAll(admissible);
        if (!ineffective.isEmpty()) {
            throw new IllegalStateException("courtside.admission.classes decides classes no request reaches, "
                    + "because they are ordinary or have no HTTP operation: " + ineffective);
        }
        return new AdmissionPlan(byOperation);
    }

    private static JsonNode required(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || value.isNull()) {
            throw new IllegalStateException("The resource demand inventory lacks " + field);
        }
        return value;
    }

    record Admission(String demandClass, int cost, Optional<Bulkhead> bulkhead) {
    }
}
