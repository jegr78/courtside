package org.courtside.rules.web;

import org.courtside.rules.internal.RuleType;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.Map;
import java.util.UUID;

final class RuleAdminWebModels {

    private RuleAdminWebModels() {
    }

    record RuleSetResponse(UUID id, String name, boolean active) {
    }

    record RuleSetRequest(@NotBlank @Size(max = 60) String name) {
    }

    record RuleDefinitionResponse(RuleType ruleType, Map<String, Integer> params) {
    }

    record SetRuleRequest(@NotNull Map<String, Integer> params) {
    }
}
