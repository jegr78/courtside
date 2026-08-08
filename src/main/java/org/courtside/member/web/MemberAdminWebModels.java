package org.courtside.member.web;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.UUID;

final class MemberAdminWebModels {

    private MemberAdminWebModels() {
    }

    record MembershipTypeResponse(UUID id, String name, UUID ruleSetId, boolean active) {
    }

    record MembershipTypeRequest(
            @NotBlank @Size(max = 60) String name,
            UUID ruleSetId) {
    }
}
