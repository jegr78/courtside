package org.courtside.dataexchange.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.AdminImportApi;
import org.courtside.api.ApiCanonicalField;
import org.courtside.api.ApiImportColumnMode;
import org.courtside.api.ApiImportColumnPosition;
import org.courtside.api.ApiImportSource;
import org.courtside.api.ApiImportSourceRequest;
import org.courtside.dataexchange.CanonicalField;
import org.courtside.dataexchange.ColumnLayout;
import org.courtside.dataexchange.ColumnMode;
import org.courtside.dataexchange.ImportSourceService;
import org.courtside.dataexchange.SupportedEncodings;
import org.courtside.dataexchange.SourceConfiguration;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@RestController
@RequiredArgsConstructor
class ImportSourceAdminController implements AdminImportApi {

    private final ImportSourceService sources;

    @Override
    public ResponseEntity<java.util.List<String>> listSupportedEncodings() {
        return ResponseEntity.ok(SupportedEncodings.names());
    }

    @Override
    public ResponseEntity<java.util.List<ApiImportSource>> listImportSources() {
        return ResponseEntity.ok(sources.all().stream()
                .map(ImportSourceAdminController::toResponse)
                .toList());
    }

    @Override
    public ResponseEntity<ApiImportSource> createImportSource(ApiImportSourceRequest request) {
        SourceConfiguration created = sources.create(request.getSourceKey(),
                request.getDisplayName(), request.getSeparator(), request.getEncoding(),
                layout(request), request.getMembershipTypes(),
                request.getDefaultMembershipTypeId(), ownedFields(request),
                request.getRemovalWarningPercent());
        return ResponseEntity
                .created(URI.create("/api/admin/import/sources/" + created.sourceId()))
                .body(toResponse(created));
    }

    @Override
    public ResponseEntity<ApiImportSource> readImportSource(UUID id) {
        return ResponseEntity.ok(toResponse(sources.configurationOf(id)));
    }

    @Override
    public ResponseEntity<ApiImportSource> changeImportSource(UUID id,
                                                              ApiImportSourceRequest request) {
        return ResponseEntity.ok(toResponse(sources.change(id, request.getSourceKey(),
                request.getDisplayName(), request.getSeparator(), request.getEncoding(),
                layout(request), request.getMembershipTypes(),
                request.getDefaultMembershipTypeId(), ownedFields(request),
                request.getRemovalWarningPercent(),
                Boolean.TRUE.equals(request.getConfirmColumnModeChange()))));
    }

    @Override
    public ResponseEntity<Void> deleteImportSource(UUID id) {
        sources.delete(id);
        return ResponseEntity.status(HttpStatus.NO_CONTENT).build();
    }

    private static ColumnLayout layout(ApiImportSourceRequest request) {
        Map<String, CanonicalField> columns = new LinkedHashMap<>();
        if (request.getColumns() != null) {
            request.getColumns().forEach((header, field) -> columns.put(header, field(field)));
        }
        Map<Integer, CanonicalField> positions = new LinkedHashMap<>();
        if (request.getPositions() != null) {
            request.getPositions().forEach(position -> positions.put(position.getPosition(), field(position.getField())));
        }
        ColumnMode mode = request.getColumnMode() == null ? ColumnMode.HEADER
                : ColumnMode.valueOf(request.getColumnMode().getValue());
        return new ColumnLayout(mode, columns, positions, request.getColumnCount());
    }

    private static Set<CanonicalField> ownedFields(ApiImportSourceRequest request) {
        Set<CanonicalField> owned = new LinkedHashSet<>();
        request.getOwnedFields().forEach(field -> owned.add(field(field)));
        return owned;
    }

    private static CanonicalField field(ApiCanonicalField field) {
        return CanonicalField.valueOf(field.getValue());
    }

    private static ApiImportSource toResponse(SourceConfiguration configuration) {
        Map<String, ApiCanonicalField> columns = new LinkedHashMap<>();
        configuration.columns().forEach((header, field) ->
                columns.put(header, ApiCanonicalField.fromValue(field.name())));
        Set<ApiCanonicalField> owned = new LinkedHashSet<>();
        configuration.ownedFields().stream().sorted()
                .forEach(field -> owned.add(ApiCanonicalField.fromValue(field.name())));
        List<ApiImportColumnPosition> positions = configuration.positions().entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .map(entry -> new ApiImportColumnPosition(entry.getKey(),
                        ApiCanonicalField.fromValue(entry.getValue().name())))
                .toList();
        return new ApiImportSource(configuration.sourceId(), configuration.sourceKey(),
                configuration.displayName(), String.valueOf(configuration.separator()),
                configuration.encoding(), ApiImportColumnMode.fromValue(configuration.columnMode().name()),
                columns, positions, configuration.columnCount(), configuration.membershipTypes(),
                configuration.defaultMembershipTypeId(), owned,
                configuration.removalWarningPercent());
    }
}
