package org.courtside.dataexchange.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.AdminImportReferencesApi;
import org.courtside.api.ApiExternalReference;
import org.courtside.api.ApiExternalReferencePage;
import org.courtside.api.ApiExternalReferenceRequest;
import org.courtside.dataexchange.ExternalLink;
import org.courtside.dataexchange.ExternalReferenceService;
import org.courtside.shared.CursorPage;
import org.courtside.shared.WireTypes;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.util.UriUtils;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

@RestController
@RequiredArgsConstructor
class ExternalReferenceAdminController implements AdminImportReferencesApi {

    private final ExternalReferenceService references;

    @Override
    public ResponseEntity<ApiExternalReferencePage> listExternalReferences(UUID sourceId, UUID cursor,
                                                                          Integer limit) {
        CursorPage.Result<ExternalLink> page = references.list(sourceId, cursor, limit);
        return ResponseEntity.ok(new ApiExternalReferencePage(
                page.items().stream().map(ExternalReferenceAdminController::toResponse).toList())
                .nextCursor(page.nextCursor()));
    }

    @Override
    public ResponseEntity<ApiExternalReference> linkExternalReference(
            UUID sourceId, ApiExternalReferenceRequest request) {
        ExternalLink link = references.link(sourceId, request.getExternalId(), request.getPersonId());
        return ResponseEntity.created(locationOf(link)).body(toResponse(link));
    }

    @Override
    public ResponseEntity<Void> unlinkExternalReference(UUID sourceId, String externalId) {
        references.unlink(sourceId, externalId);
        return ResponseEntity.noContent().build();
    }

    private static URI locationOf(ExternalLink link) {
        return URI.create("/api/admin/import/sources/" + link.sourceId() + "/references/"
                + UriUtils.encodePathSegment(link.externalId(), StandardCharsets.UTF_8));
    }

    private static ApiExternalReference toResponse(ExternalLink link) {
        return new ApiExternalReference(link.referenceId(), link.sourceId(), link.externalId(),
                link.personId(), WireTypes.toOffsetDateTime(link.linkedAt()));
    }
}
