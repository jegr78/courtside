package org.courtside.member.internal;

public class MembershipTypeNotFoundException extends RuntimeException {

    public MembershipTypeNotFoundException(String message) {
        super(message);
    }
}
