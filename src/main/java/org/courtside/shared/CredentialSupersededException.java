package org.courtside.shared;

public final class CredentialSupersededException extends RuntimeException {
    public CredentialSupersededException() {
        super("The credential request was superseded");
    }
}
