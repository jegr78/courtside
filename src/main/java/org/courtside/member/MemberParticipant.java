package org.courtside.member;

import java.util.UUID;

public record MemberParticipant(UUID personId, String displayName) {
}
