package org.courtside.rules.web;

import org.courtside.rules.internal.RuleAdminService;
import org.courtside.rules.internal.RuleDefinition;
import org.courtside.rules.internal.RuleSet;
import org.courtside.rules.internal.RuleType;
import org.courtside.rules.web.RuleAdminWebModels.RuleDefinitionResponse;
import org.courtside.rules.web.RuleAdminWebModels.RuleSetRequest;
import org.courtside.rules.web.RuleAdminWebModels.RuleSetResponse;
import org.courtside.rules.web.RuleAdminWebModels.SetRuleRequest;
import org.courtside.shared.ActiveRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/admin/rule-sets")
@RequiredArgsConstructor
class RuleAdminController {

    private final RuleAdminService ruleSets;

    @GetMapping
    List<RuleSetResponse> ruleSets() {
        return ruleSets.allRuleSets().stream()
                .map(RuleAdminController::toResponse)
                .toList();
    }

    @PostMapping
    ResponseEntity<RuleSetResponse> create(@Valid @RequestBody RuleSetRequest request) {
        RuleSet ruleSet = ruleSets.createRuleSet(request.name());
        return ResponseEntity
                .created(URI.create("/api/admin/rule-sets/" + ruleSet.getId()))
                .body(toResponse(ruleSet));
    }

    @PutMapping("/{id}")
    RuleSetResponse change(@PathVariable UUID id, @Valid @RequestBody RuleSetRequest request) {
        return toResponse(ruleSets.changeRuleSet(id, request.name()));
    }

    @PutMapping("/{id}/active")
    RuleSetResponse setActive(@PathVariable UUID id, @Valid @RequestBody ActiveRequest request) {
        return toResponse(ruleSets.setRuleSetActive(id, request.active()));
    }

    @GetMapping("/{id}")
    RuleSetResponse ruleSet(@PathVariable UUID id) {
        return toResponse(ruleSets.requireRuleSet(id));
    }

    @GetMapping("/{id}/rules")
    List<RuleDefinitionResponse> rules(@PathVariable UUID id) {
        return ruleSets.rulesOf(id).stream()
                .map(RuleAdminController::toResponse)
                .toList();
    }

    @PutMapping("/{id}/rules/{ruleType}")
    RuleDefinitionResponse setRule(@PathVariable UUID id, @PathVariable RuleType ruleType,
            @Valid @RequestBody SetRuleRequest request) {
        return toResponse(ruleSets.setRule(id, ruleType, request.params()));
    }

    @DeleteMapping("/{id}/rules/{ruleType}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void removeRule(@PathVariable UUID id, @PathVariable RuleType ruleType) {
        ruleSets.removeRule(id, ruleType);
    }

    private static RuleSetResponse toResponse(RuleSet ruleSet) {
        return new RuleSetResponse(ruleSet.getId(), ruleSet.getName(), ruleSet.isActive());
    }

    private static RuleDefinitionResponse toResponse(RuleDefinition definition) {
        return new RuleDefinitionResponse(definition.getRuleType(), definition.getParams());
    }
}
