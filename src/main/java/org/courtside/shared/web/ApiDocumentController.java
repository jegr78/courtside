package org.courtside.shared.web;

import org.courtside.api.DocumentationApi;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;

// The document an instance answers to, not the one in the repository.
@RestController
class ApiDocumentController implements DocumentationApi {

    // Read once at startup: it cannot change while the instance runs.
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
