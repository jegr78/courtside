package org.courtside.dataexchange.internal;

import org.courtside.dataexchange.ResolvedChangeSet;

import java.util.List;
import java.util.Map;

public record PreviewContent(ResolvedChangeSet changeSet, List<String> ignoredColumns,
                             Map<String, Integer> leftOutRows, Map<String, Integer> ageFallbackRows) {

    // A preview stored before a source could leave rows out counted none.
    public PreviewContent {
        ignoredColumns = List.copyOf(ignoredColumns);
        leftOutRows = leftOutRows == null ? Map.of() : Map.copyOf(leftOutRows);
        ageFallbackRows = ageFallbackRows == null ? Map.of() : Map.copyOf(ageFallbackRows);
    }
}
