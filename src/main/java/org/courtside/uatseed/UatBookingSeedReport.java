package org.courtside.uatseed;

import java.util.List;

record UatBookingSeedReport(boolean write, int planned, int inserted, int existing,
                            int conflicts, List<String> unavailable) {

    String summary() {
        String mode = write ? "written" : "previewed";
        String omitted = unavailable.isEmpty() ? "none" : String.join(", ", unavailable);
        return "UAT booking seed " + mode + ": planned=" + planned + ", inserted=" + inserted
                + ", existing=" + existing + ", conflicts=" + conflicts
                + ", unavailable=" + omitted;
    }
}
