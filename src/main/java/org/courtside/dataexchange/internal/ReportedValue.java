package org.courtside.dataexchange.internal;

public final class ReportedValue {

    private static final int MAX_LENGTH = 60;

    private ReportedValue() {
    }

    // What is echoed back names which entry was refused; it is not the place to carry a whole
    // submission back to a client, nor a control character into a log line.
    public static String printable(String value) {
        int[] kept = value.codePoints().filter(codePoint -> !Character.isISOControl(codePoint)).toArray();
        String shown = new String(kept, 0, Math.min(kept.length, MAX_LENGTH));
        return kept.length > MAX_LENGTH ? shown + "…" : shown;
    }
}
