package org.courtside.dataexchange.internal;

import org.courtside.dataexchange.CanonicalField;

import java.util.List;
import java.util.Map;
import java.util.UUID;

public record CsvSnapshot(List<SnapshotRow> rows, List<RowError> errors, List<String> ignoredColumns,
                          Map<String, Integer> leftOutRows, Map<String, Integer> ageFallbackRows) {

    public CsvSnapshot {
        rows = List.copyOf(rows);
        errors = List.copyOf(errors);
        ignoredColumns = List.copyOf(ignoredColumns);
        leftOutRows = Map.copyOf(leftOutRows);
        ageFallbackRows = Map.copyOf(ageFallbackRows);
    }

    public CsvSnapshot(List<SnapshotRow> rows, List<RowError> errors, List<String> ignoredColumns,
                       Map<String, Integer> leftOutRows) {
        this(rows, errors, ignoredColumns, leftOutRows, Map.of());
    }

    public record SnapshotRow(int rowNumber, String externalId, Map<CanonicalField, String> values,
                              UUID bandedTypeId) {

        public SnapshotRow {
            values = Map.copyOf(values);
        }

        public SnapshotRow(int rowNumber, String externalId, Map<CanonicalField, String> values) {
            this(rowNumber, externalId, values, null);
        }
    }

    public record RowError(int rowNumber, String code, Map<String, Object> params) {

        public RowError {
            params = Map.copyOf(params);
        }
    }
}
