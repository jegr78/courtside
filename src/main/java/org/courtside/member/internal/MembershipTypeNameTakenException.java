package org.courtside.member.internal;

public class MembershipTypeNameTakenException extends RuntimeException {

    public MembershipTypeNameTakenException(String message, Throwable cause) {
        super(message, cause);
    }
}
