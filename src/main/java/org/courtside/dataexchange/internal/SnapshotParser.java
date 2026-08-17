package org.courtside.dataexchange.internal;

import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.commons.csv.CSVRecord;
import org.apache.commons.csv.DuplicateHeaderMode;
import org.courtside.dataexchange.CanonicalField;

import java.io.IOException;
import java.io.StringReader;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class SnapshotParser {

    private static final Set<CanonicalField> REQUIRED_FIELDS = EnumSet.of(
            CanonicalField.EXTERNAL_ID, CanonicalField.FIRST_NAME, CanonicalField.LAST_NAME,
            CanonicalField.EMAIL);
    private static final byte[] BYTE_ORDER_MARK = {(byte) 0xEF, (byte) 0xBB, (byte) 0xBF};

    private SnapshotParser() {
    }

    public static CsvSnapshot parse(byte[] content, Map<String, CanonicalField> columns) {
        try (CSVParser parser = format().parse(new StringReader(decoded(content)))) {
            List<String> headerNames = parser.getHeaderNames();
            return read(parser, headerOf(headerNames, columns), headerNames.size(),
                    ignoredColumns(headerNames, columns));
        } catch (IOException e) {
            throw new SnapshotHeaderInvalidException("import.snapshot.unreadable", Map.of());
        }
    }

    private static CSVFormat format() {
        return CSVFormat.DEFAULT.builder()
                .setHeader()
                .setSkipHeaderRecord(true)
                .setDuplicateHeaderMode(DuplicateHeaderMode.ALLOW_ALL)
                .setTrim(true)
                .get();
    }

    private static CsvSnapshot read(CSVParser parser, Map<String, CanonicalField> header,
                                    int cellsPerRow, List<String> ignoredColumns) {
        List<CsvSnapshot.SnapshotRow> rows = new ArrayList<>();
        List<CsvSnapshot.RowError> errors = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        int rowNumber = 0;
        for (CSVRecord record : parser) {
            rowNumber++;
            CsvSnapshot.RowError shape = shapeErrorOf(record, rowNumber, cellsPerRow);
            if (shape != null) {
                errors.add(shape);
                continue;
            }
            Map<CanonicalField, String> values = valuesOf(record, header);
            String externalId = values.remove(CanonicalField.EXTERNAL_ID);
            if (!MemberNumber.isUsable(externalId)) {
                errors.add(new CsvSnapshot.RowError(rowNumber,
                        "import.snapshot.row.externalIdUnusable",
                        Map.of("maxLength", MemberNumber.MAX_LENGTH)));
            } else if (!seen.add(externalId)) {
                errors.add(new CsvSnapshot.RowError(rowNumber,
                        "import.snapshot.row.duplicateExternalId", Map.of("externalId", externalId)));
            } else {
                rows.add(new CsvSnapshot.SnapshotRow(rowNumber, externalId, values));
            }
        }
        return new CsvSnapshot(rows, errors, ignoredColumns);
    }

    private static CsvSnapshot.RowError shapeErrorOf(CSVRecord record, int rowNumber, int headerSize) {
        if (record.size() < headerSize) {
            return new CsvSnapshot.RowError(rowNumber, "import.snapshot.row.cellsMissing",
                    Map.of("expected", headerSize, "found", record.size()));
        }
        if (record.size() > headerSize) {
            return new CsvSnapshot.RowError(rowNumber, "import.snapshot.row.cellsUnexpected",
                    Map.of("expected", headerSize, "found", record.size()));
        }
        return null;
    }

    private static Map<CanonicalField, String> valuesOf(CSVRecord record,
                                                        Map<String, CanonicalField> header) {
        Map<CanonicalField, String> values = new EnumMap<>(CanonicalField.class);
        header.forEach((column, field) -> values.put(field, record.get(column).strip()));
        return values;
    }

    private static Map<String, CanonicalField> headerOf(List<String> headerNames,
                                                        Map<String, CanonicalField> columns) {
        if (headerNames.isEmpty()) {
            throw new SnapshotHeaderInvalidException("import.snapshot.header.missing", Map.of());
        }
        Map<String, CanonicalField> header = new LinkedHashMap<>();
        Set<CanonicalField> claimed = EnumSet.noneOf(CanonicalField.class);
        for (String name : headerNames) {
            CanonicalField field = columns.get(name.strip());
            if (field == null) {
                continue;
            }
            if (!claimed.add(field)) {
                throw new SnapshotHeaderInvalidException("import.snapshot.header.duplicateColumn",
                        Map.of("column", name.strip()));
            }
            header.put(name, field);
        }
        Set<CanonicalField> missing = EnumSet.copyOf(REQUIRED_FIELDS);
        missing.removeAll(claimed);
        if (!missing.isEmpty()) {
            throw new SnapshotHeaderInvalidException("import.snapshot.header.missingField",
                    Map.of("missing", missing.stream().map(Enum::name).sorted().toList()));
        }
        return header;
    }

    private static List<String> ignoredColumns(List<String> headerNames,
                                               Map<String, CanonicalField> columns) {
        return headerNames.stream()
                .filter(name -> !columns.containsKey(name.strip()))
                .map(String::strip)
                .distinct()
                .toList();
    }

    private static String decoded(byte[] content) {
        byte[] withoutMark = startsWithByteOrderMark(content)
                ? Arrays.copyOfRange(content, BYTE_ORDER_MARK.length, content.length)
                : content;
        try {
            CharBuffer decoded = StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(withoutMark));
            return decoded.toString();
        } catch (CharacterCodingException e) {
            throw new SnapshotHeaderInvalidException("import.snapshot.notUtf8", Map.of());
        }
    }

    private static boolean startsWithByteOrderMark(byte[] content) {
        return content.length >= BYTE_ORDER_MARK.length
                && Arrays.equals(content, 0, BYTE_ORDER_MARK.length,
                BYTE_ORDER_MARK, 0, BYTE_ORDER_MARK.length);
    }
}
