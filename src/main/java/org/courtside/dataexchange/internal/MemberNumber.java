package org.courtside.dataexchange.internal;

public record MemberNumber(String value) {

    public static final int MAX_LENGTH = 120;

    public MemberNumber {
        if (!isUsable(value)) {
            throw new IllegalArgumentException(
                    "A member number carries something and is at most " + MAX_LENGTH + " characters");
        }
        value = value.strip();
    }

    public static boolean isUsable(String value) {
        if (value == null) {
            return false;
        }
        String stripped = value.strip();
        return !stripped.isEmpty() && stripped.length() <= MAX_LENGTH
                && stripped.indexOf('\n') < 0 && stripped.indexOf('\r') < 0;
    }
}
