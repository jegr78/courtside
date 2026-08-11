package org.courtside.member.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.ApiPublicParticipantMember;
import org.courtside.api.ParticipantsApi;
import org.courtside.member.MemberService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequiredArgsConstructor
class ParticipantMemberController implements ParticipantsApi {

    private final MemberService members;

    @Override
    public ResponseEntity<List<ApiPublicParticipantMember>> listParticipantMembers(String query) {
        return ResponseEntity.ok(members.findParticipants(query).stream()
                .map(member -> new ApiPublicParticipantMember(member.personId(), member.displayName()))
                .toList());
    }
}
