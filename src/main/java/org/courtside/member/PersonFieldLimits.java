package org.courtside.member;

public final class PersonFieldLimits {

    public static final int MAX_NAME_LENGTH = 60;
    public static final int MAX_EMAIL_LENGTH = 120;

    private PersonFieldLimits() {
    }

    public static boolean isUsableName(String value) {
        return isUsable(value, MAX_NAME_LENGTH);
    }

    // Spelled out rather than matched: the equivalent pattern backtracks over every candidate dot,
    // and its safety would rest on the length check in front of it rather than on the rule itself.
    public static boolean isUsableEmail(String value) {
        if (!isUsable(value, MAX_EMAIL_LENGTH)) {
            return false;
        }
        String stripped = value.strip();
        int at = stripped.indexOf('@');
        int dot = stripped.lastIndexOf('.');
        return at > 0 && at == stripped.lastIndexOf('@')
                && dot > at + 1 && dot < stripped.length() - 1
                && stripped.chars().noneMatch(Character::isWhitespace);
    }

    public static boolean isUsableOrAbsentEmail(String value) {
        return value == null || value.strip().isEmpty() || isUsableEmail(value);
    }

    private static boolean isUsable(String value, int maxLength) {
        if (value == null) {
            return false;
        }
        String stripped = value.strip();
        return !stripped.isEmpty() && stripped.length() <= maxLength && carriesNoControls(stripped);
    }

    // A control character is not storable text: PostgreSQL refuses a NUL outright, and the rest
    // read as padding nobody typed.
    private static boolean carriesNoControls(String value) {
        return value.codePoints().noneMatch(Character::isISOControl);
    }
}
