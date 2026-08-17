package org.courtside.dataexchange.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.AdminImportApi;
import org.courtside.api.ApiCanonicalField;
import org.courtside.api.ApiImportSource;
import org.courtside.api.ApiImportSourceRequest;
import org.courtside.dataexchange.CanonicalField;
import org.courtside.dataexchange.ImportSourceService;
import org.courtside.dataexchange.SourceConfiguration;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@RestController
@RequiredArgsConstructor
class ImportSourceAdminController implements AdminImportApi {

    private final ImportSourceService sources;

    @Override
    public ResponseEntity<java.util.List<ApiImportSource>> listImportSources() {
        return ResponseEntity.ok(sources.all().stream()
                .map(ImportSourceAdminController::toResponse)
                .toList());
    }

    @Override
    public ResponseEntity<ApiImportSource> createImportSource(ApiImportSourceRequest request) {
        SourceConfiguration created = sources.create(request.getSourceKey(),
                request.getDisplayName(), columns(request), request.getMembershipTypes(),
                ownedFields(request), request.getRemovalWarningPercent());
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
                request.getDisplayName(), columns(request), request.getMembershipTypes(),
                ownedFields(request), request.getRemovalWarningPercent())));
    }

    @Override
    public ResponseEntity<Void> deleteImportSource(UUID id) {
        sources.delete(id);
        return ResponseEntity.status(HttpStatus.NO_CONTENT).build();
    }

    private static Map<String, CanonicalField> columns(ApiImportSourceRequest request) {
        Map<String, CanonicalField> columns = new LinkedHashMap<>();
        request.getColumns().forEach((header, field) -> columns.put(header, field(field)));
        return columns;
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
        return new ApiImportSource(configuration.sourceId(), configuration.sourceKey(),
                configuration.displayName(), columns, configuration.membershipTypes(), owned,
                configuration.removalWarningPercent());
    }
}
