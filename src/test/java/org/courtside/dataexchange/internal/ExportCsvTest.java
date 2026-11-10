package org.courtside.dataexchange.internal;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class ExportCsvTest {

    @Test
    void givenAHeaderCellThatOpensAFormula_whenTheFileIsWritten_thenTheHeaderIsNeutralisedLikeAnyCell() {
        // when
        String written = new String(ExportCsv.write(List.of("=SUM(A1:A9)", "lastName"),
                List.of(List.of("=1+1", "Doe")), ';', StandardCharsets.UTF_8), StandardCharsets.UTF_8);

        // then
        assertThat(written.lines().toList())
                .as("a header cell a spreadsheet would evaluate starts with an apostrophe, as a data cell does")
                .containsExactly("\uFEFF'=SUM(A1:A9);lastName", "'=1+1;Doe");
    }
}
