package org.courtside.shared.web;

import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

// An instance hands out its own contract. Clubs run their own instances and update on their own
// schedule, so the document in this repository describes some version and the one here describes
// the version actually answering — which is the one an integrator is writing against.
@RestController
class ApiDocumentController {

    private static final String MEDIA_TYPE = "application/yaml";

    @GetMapping(value = "/api/openapi.yaml", produces = MEDIA_TYPE)
    ResponseEntity<Resource> document() {
        return ResponseEntity.ok(new ClassPathResource("api/openapi.yaml"));
    }
}
