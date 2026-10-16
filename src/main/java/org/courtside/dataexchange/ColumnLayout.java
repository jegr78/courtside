package org.courtside.dataexchange;

import java.util.Map;

public record ColumnLayout(ColumnMode mode, Map<String, CanonicalField> headers,
                           Map<Integer, CanonicalField> positions, Integer columnCount) {

    public ColumnLayout {
        mode = mode == null ? ColumnMode.HEADER : mode;
        headers = headers == null ? Map.of() : headers;
        positions = positions == null ? Map.of() : positions;
    }

    public static ColumnLayout headers(Map<String, CanonicalField> headers) {
        return new ColumnLayout(ColumnMode.HEADER, headers, Map.of(), null);
    }

    public static ColumnLayout positions(Map<Integer, CanonicalField> positions, int columnCount) {
        return new ColumnLayout(ColumnMode.POSITION, Map.of(), positions, columnCount);
    }
}
