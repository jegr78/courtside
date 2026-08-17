package org.courtside.member;

public final class PersonFieldLimits {

    public static final int MAX_NAME_LENGTH = 60;
    public static final int MAX_EMAIL_LENGTH = 120;

    private PersonFieldLimits() {
    }

    public static boolean isUsableName(String value) {
        return isUsable(value, MAX_NAME_LENGTH);
    }

    public static boolean isUsableEmail(String value) {
        return isUsable(value, MAX_EMAIL_LENGTH)
                && value.strip().matches("[^@\\s]+@[^@\\s]+\\.[^@\\s]+");
    }

    private static boolean isUsable(String value, int maxLength) {
        if (value == null) {
            return false;
        }
        String stripped = value.strip();
        return !stripped.isEmpty() && stripped.length() <= maxLength
                && stripped.indexOf('\n') < 0 && stripped.indexOf('\r') < 0;
    }
}
