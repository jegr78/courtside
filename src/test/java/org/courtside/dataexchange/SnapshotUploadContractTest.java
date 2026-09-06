package org.courtside.dataexchange;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class SnapshotUploadContractTest {

    @Test
    void whenTheDocumentNamesTheTypesAPartMayDeclare_thenTheyAreTheOnesTheUploadAccepts()
            throws IOException {
        // given
        String document = Files.readString(Path.of("src/main/resources/api/openapi.yaml"));

        // when
        List<String> declared = document.lines()
                .map(String::strip)
                .filter(line -> line.startsWith("contentType: "))
                .flatMap(line -> Arrays.stream(line.substring("contentType: ".length()).split(",")))
                .map(String::strip)
                .toList();

        // then — the document is the source of truth, so the guard follows it and not the other way
        assertThat(declared)
                .as("the roster part's accepted types are declared once, in the API document")
                .containsExactlyElementsOf(SnapshotUpload.MEDIA_TYPES);
    }
}
