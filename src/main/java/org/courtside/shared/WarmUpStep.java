package org.courtside.shared;

/** A request path the instance exercises before it reports ready, without leaving anything behind. */
public interface WarmUpStep {

    String name();

    /** Returns {@code false} when the instance holds nothing this step could exercise. */
    boolean run() throws Exception;

    /** The most rounds this step runs, whatever the warm-up's own round count. */
    default int roundBudget() {
        return Integer.MAX_VALUE;
    }
}
