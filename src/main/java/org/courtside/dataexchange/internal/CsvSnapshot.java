package org.courtside.dataexchange.internal;

import org.courtside.dataexchange.CanonicalField;

import java.util.List;
import java.util.Map;

public record CsvSnapshot(List<SnapshotRow> rows, List<RowError> errors, List<String> ignoredColumns,
                          Map<String, Integer> leftOutRows) {

    public CsvSnapshot {
        rows = List.copyOf(rows);
        errors = List.copyOf(errors);
        ignoredColumns = List.copyOf(ignoredColumns);
        leftOutRows = Map.copyOf(leftOutRows);
    }

    public record SnapshotRow(int rowNumber, String externalId, Map<CanonicalField, String> values) {

        public SnapshotRow {
            values = Map.copyOf(values);
        }
    }

    public record RowError(int rowNumber, String code, Map<String, Object> params) {

        public RowError {
            params = Map.copyOf(params);
        }
    }
}
