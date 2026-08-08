package org.courtside.member.web;

import org.courtside.member.MemberService;
import org.courtside.member.internal.MembershipType;
import org.courtside.member.web.MemberAdminWebModels.MembershipTypeRequest;
import org.courtside.member.web.MemberAdminWebModels.MembershipTypeResponse;
import org.courtside.shared.ActiveRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/admin/membership-types")
@RequiredArgsConstructor
class MembershipTypeAdminController {

    private final MemberService members;

    @GetMapping
    List<MembershipTypeResponse> membershipTypes() {
        return members.allMembershipTypes().stream()
                .map(MembershipTypeAdminController::toResponse)
                .toList();
    }

    @PostMapping
    ResponseEntity<MembershipTypeResponse> create(@Valid @RequestBody MembershipTypeRequest request) {
        MembershipType type = members.createMembershipType(request.name(), request.ruleSetId());
        return ResponseEntity
                .created(URI.create("/api/admin/membership-types/" + type.getId()))
                .body(toResponse(type));
    }

    @PutMapping("/{id}")
    MembershipTypeResponse change(@PathVariable UUID id, @Valid @RequestBody MembershipTypeRequest request) {
        return toResponse(members.changeMembershipType(id, request.name(), request.ruleSetId()));
    }

    @PutMapping("/{id}/active")
    MembershipTypeResponse setActive(@PathVariable UUID id, @Valid @RequestBody ActiveRequest request) {
        return toResponse(members.setMembershipTypeActive(id, request.active()));
    }

    @GetMapping("/{id}")
    MembershipTypeResponse membershipType(@PathVariable UUID id) {
        return toResponse(members.requireMembershipType(id));
    }

    private static MembershipTypeResponse toResponse(MembershipType type) {
        return new MembershipTypeResponse(
                type.getId(), type.getName(), type.getRuleSetId(), type.isActive());
    }
}
