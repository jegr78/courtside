package org.courtside.member.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.ApiDependant;
import org.courtside.api.ApiGuardianGrant;
import org.courtside.api.DependantsApi;
import org.courtside.member.DependantService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

@RestController
@RequiredArgsConstructor
class DependantController implements DependantsApi {

    private final DependantService dependants;

    @Override
    public ResponseEntity<List<ApiDependant>> listDependants() {
        return ResponseEntity.ok(dependants.dependantsOfCurrentAccount().stream()
                .map(dependant -> new ApiDependant(dependant.personId(), dependant.firstName(), dependant.lastName(),
                        dependant.grants().stream().sorted().map(grant -> ApiGuardianGrant.fromValue(grant.name()))
                                .collect(Collectors.toCollection(LinkedHashSet::new)),
                        dependant.endedOn()))
                .toList());
    }

    @Override
    public ResponseEntity<Void> requestDependantCredentials(UUID personId) {
        dependants.requestCredentials(personId);
        return ResponseEntity.noContent().build();
    }
}
