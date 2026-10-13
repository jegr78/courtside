package org.courtside.member.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.ApiParticipantMemberSearchRequest;
import org.courtside.api.ApiPublicParticipantMember;
import org.courtside.api.ParticipantsApi;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.Person;
import org.courtside.identity.UserAccount;
import org.courtside.member.MemberService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequiredArgsConstructor
class ParticipantMemberController implements ParticipantsApi {

    private final MemberService members;
    private final CurrentUser currentUser;

    @Override
    public ResponseEntity<List<ApiPublicParticipantMember>> searchParticipantMembers(
            ApiParticipantMemberSearchRequest request) {
        UUID searcher = currentUser.account().map(UserAccount::getPerson).map(Person::getId).orElse(null);
        return ResponseEntity.ok(members.findParticipants(request.getQuery(), searcher).stream()
                .map(member -> new ApiPublicParticipantMember(member.personId(), member.displayName()))
                .toList());
    }
}
