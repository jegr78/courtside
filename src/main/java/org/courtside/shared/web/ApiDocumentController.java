package org.courtside.shared.web;

import org.courtside.api.DocumentationApi;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;

// An instance hands out its own contract. Clubs run their own instances and update on their own
// schedule, so the document in this repository describes some version and the one here describes
// the version actually answering — which is the one an integrator is writing against.
@RestController
class ApiDocumentController implements DocumentationApi {

    // Read once at startup rather than per request: it is a file on this instance's own classpath
    // that cannot change while the instance runs, and a failure to read it should surface then
    // rather than the first time somebody asks for the contract.
    private final String document = read();

    @Override
    public ResponseEntity<String> getApiDocument() {
        return ResponseEntity.ok(document);
    }

    private static String read() {
        try {
            return new ClassPathResource("api/openapi.yaml")
                    .getContentAsString(StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException("This instance cannot read its own API document", e);
        }
    }
}
