package org.courtside.shared.web;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.concurrent.Semaphore;

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
        } catch (IOException failure) {
            throw new IllegalStateException("The resource demand inventory cannot be read", failure);
        }
    }

    static AdmissionPlan from(JsonNode inventory, AdmissionProperties properties) {
        int smallestBurst = Math.min(properties.account().burst(), properties.address().burst());
        Set<String> known = new TreeSet<>();
        Set<String> undecided = new TreeSet<>();
        Map<String, Admission> byOperation = new HashMap<>();
        for (JsonNode classification : inventory.get("classifications")) {
            String id = classification.get("id").asString();
            known.add(id);
            if (!"demanding".equals(classification.get("kind").asString())) {
                continue;
            }
            Set<String> operations = new TreeSet<>();
            classification.get("entryPoints").forEach(entry -> {
                if (!entry.asString().contains("#")) {
                    operations.add(entry.asString());
                }
            });
            if (operations.isEmpty()) {
                continue;
            }
            AdmissionProperties.DemandClass decided = properties.classes().get(id);
            if (decided == null) {
                undecided.add(id);
                continue;
            }
            if (decided.cost() > smallestBurst) {
                throw new IllegalStateException("courtside.admission.classes." + id
                        + ".cost exceeds the smallest burst, so no request of that class could ever be admitted");
            }
            Optional<Semaphore> bulkhead = Optional.ofNullable(decided.concurrency())
                    .map(permits -> new Semaphore(permits));
            Admission admission = new Admission(id, decided.cost(), bulkhead);
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
        return new AdmissionPlan(byOperation);
    }

    record Admission(String demandClass, int cost, Optional<Semaphore> bulkhead) {
    }
}
