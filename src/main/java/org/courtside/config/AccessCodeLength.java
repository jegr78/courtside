package org.courtside.config;

public record AccessCodeLength(int digits) {

    public AccessCodeLength {
        if (!isValid(digits)) {
            throw new IllegalArgumentException("An access code has 4 to 8 digits");
        }
    }

    public static boolean isValid(int digits) {
        return digits >= 4 && digits <= 8;
    }

    public boolean fits(String code) {
        return code != null && code.length() == digits && code.chars().allMatch(c -> c >= '0' && c <= '9');
    }
}
