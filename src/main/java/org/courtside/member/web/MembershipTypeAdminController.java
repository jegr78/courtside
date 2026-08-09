package org.courtside.member.web;

import org.courtside.api.AdminMembershipTypesApi;
import org.courtside.api.ApiActiveRequest;
import org.courtside.api.ApiMembershipType;
import org.courtside.api.ApiMembershipTypeRequest;
import org.courtside.member.MemberService;
import org.courtside.member.internal.MembershipType;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.List;
import java.util.UUID;

@RestController
@RequiredArgsConstructor
class MembershipTypeAdminController implements AdminMembershipTypesApi {

    private final MemberService members;

    @Override
    public ResponseEntity<List<ApiMembershipType>> listMembershipTypes() {
        return ResponseEntity.ok(members.allMembershipTypes().stream()
                .map(MembershipTypeAdminController::toResponse)
                .toList());
    }

    @Override
    public ResponseEntity<ApiMembershipType> createMembershipType(ApiMembershipTypeRequest request) {
        MembershipType type = members.createMembershipType(request.getName(), request.getRuleSetId());
        return ResponseEntity
                .created(URI.create("/api/admin/membership-types/" + type.getId()))
                .body(toResponse(type));
    }

    @Override
    public ResponseEntity<ApiMembershipType> changeMembershipType(
            UUID id, ApiMembershipTypeRequest request) {
        return ResponseEntity.ok(toResponse(
                members.changeMembershipType(id, request.getName(), request.getRuleSetId())));
    }

    @Override
    public ResponseEntity<ApiMembershipType> setMembershipTypeActive(UUID id, ApiActiveRequest request) {
        return ResponseEntity.ok(
                toResponse(members.setMembershipTypeActive(id, request.getActive())));
    }

    @Override
    public ResponseEntity<ApiMembershipType> getMembershipType(UUID id) {
        return ResponseEntity.ok(toResponse(members.requireMembershipType(id)));
    }

    private static ApiMembershipType toResponse(MembershipType type) {
        return new ApiMembershipType(type.getId(), type.getName(), type.isActive())
                .ruleSetId(type.getRuleSetId());
    }
}
