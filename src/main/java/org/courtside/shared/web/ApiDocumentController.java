package org.courtside.shared.web;

import org.courtside.api.DocumentationApi;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;

// Clubs update on their own schedule, so the document in the repository and the one an instance
// answers to are not the same document. This is the second.
@RestController
class ApiDocumentController implements DocumentationApi {

    // Read once at startup: it cannot change while the instance runs, and a failure to read it
    // should stop the start rather than the first request for it.
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
