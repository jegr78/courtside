package org.courtside.rules.web;

import org.courtside.api.AdminRuleSetsApi;
import org.courtside.api.AdminRuleTypesApi;
import org.courtside.api.ApiActiveRequest;
import org.courtside.api.ApiRuleDefinition;
import org.courtside.api.ApiRuleSet;
import org.courtside.api.ApiRuleSetRequest;
import org.courtside.api.ApiRuleParameter;
import org.courtside.api.ApiRuleType;
import org.courtside.api.ApiRuleTypeConfiguration;
import org.courtside.api.ApiSetRuleRequest;
import org.courtside.rules.internal.RuleAdminService;
import org.courtside.rules.internal.RuleDefinition;
import org.courtside.rules.internal.RuleParameters;
import org.courtside.rules.internal.RuleSet;
import org.courtside.rules.internal.RuleType;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

@RestController
@RequiredArgsConstructor
class RuleAdminController implements AdminRuleSetsApi, AdminRuleTypesApi {

    private final RuleAdminService ruleSets;

    @Override
    public ResponseEntity<List<ApiRuleSet>> listRuleSets() {
        return ResponseEntity.ok(ruleSets.allRuleSets().stream()
                .map(RuleAdminController::toResponse)
                .toList());
    }

    @Override
    public ResponseEntity<ApiRuleSet> createRuleSet(ApiRuleSetRequest request) {
        RuleSet ruleSet = ruleSets.createRuleSet(request.getName());
        return ResponseEntity
                .created(URI.create("/api/admin/rule-sets/" + ruleSet.getId()))
                .body(toResponse(ruleSet));
    }

    @Override
    public ResponseEntity<ApiRuleSet> changeRuleSet(UUID id, ApiRuleSetRequest request) {
        return ResponseEntity.ok(toResponse(ruleSets.changeRuleSet(id, request.getName())));
    }

    @Override
    public ResponseEntity<ApiRuleSet> setRuleSetActive(UUID id, ApiActiveRequest request) {
        return ResponseEntity.ok(toResponse(ruleSets.setRuleSetActive(id, request.getActive())));
    }

    @Override
    public ResponseEntity<ApiRuleSet> getRuleSet(UUID id) {
        return ResponseEntity.ok(toResponse(ruleSets.requireRuleSet(id)));
    }

    @Override
    public ResponseEntity<List<ApiRuleDefinition>> listRules(UUID id) {
        return ResponseEntity.ok(ruleSets.rulesOf(id).stream()
                .map(RuleAdminController::toResponse)
                .toList());
    }

    @Override
    public ResponseEntity<List<ApiRuleTypeConfiguration>> listRuleTypes() {
        return ResponseEntity.ok(Arrays.stream(RuleType.values())
                .map(type -> new ApiRuleTypeConfiguration(
                        ApiRuleType.fromValue(type.name()),
                        RuleParameters.isConfigurablePerRuleSet(type),
                        RuleParameters.parametersOf(type).stream()
                                .map(parameter -> new ApiRuleParameter(
                                        parameter.name(), parameter.minimum(), parameter.maximum()))
                                .toList()))
                .toList());
    }

    @Override
    public ResponseEntity<ApiRuleDefinition> setRule(
            UUID id, ApiRuleType ruleType, ApiSetRuleRequest request) {
        return ResponseEntity.ok(
                toResponse(ruleSets.setRule(id, toRuleType(ruleType), request.getParams())));
    }

    @Override
    public ResponseEntity<Void> removeRule(UUID id, ApiRuleType ruleType) {
        ruleSets.removeRule(id, toRuleType(ruleType));
        return ResponseEntity.noContent().build();
    }

    private static RuleType toRuleType(ApiRuleType ruleType) {
        return RuleType.valueOf(ruleType.getValue());
    }

    private static ApiRuleSet toResponse(RuleSet ruleSet) {
        return new ApiRuleSet(ruleSet.getId(), ruleSet.getName(), ruleSet.isActive());
    }

    private static ApiRuleDefinition toResponse(RuleDefinition definition) {
        return new ApiRuleDefinition(
                ApiRuleType.fromValue(definition.getRuleType().name()), definition.getParams());
    }
}
