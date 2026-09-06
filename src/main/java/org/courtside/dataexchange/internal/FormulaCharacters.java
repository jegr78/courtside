package org.courtside.dataexchange.internal;

public final class FormulaCharacters {

    private static final String OPENERS = "=+-@\t\r";

    private FormulaCharacters() {
    }

    public static boolean opensAFormula(String value) {
        return !value.isEmpty() && OPENERS.indexOf(value.charAt(0)) >= 0;
    }

    // The export writes the quote so a spreadsheet shows the value instead of evaluating it, and
    // the import takes exactly that one back so a round trip returns the value the club stored.
    public static String withoutTheEscape(String value) {
        return value.length() > 1 && value.charAt(0) == '\''
                && OPENERS.indexOf(value.charAt(1)) >= 0
                ? value.substring(1)
                : value;
    }
}
