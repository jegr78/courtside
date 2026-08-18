package org.courtside.dataexchange.internal;

import org.courtside.dataexchange.ResolvedChangeSet;

import java.util.List;

public record PreviewContent(ResolvedChangeSet changeSet, List<String> ignoredColumns) {

    public PreviewContent {
        ignoredColumns = List.copyOf(ignoredColumns);
    }
}
