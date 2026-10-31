package org.courtside.access;

import org.jspecify.annotations.NullMarked;
import org.jspecify.annotations.Nullable;

import java.util.Map;

/** One check's outcome as an i18n code and its parameters; a parameter never carries a credential or a code. */
@NullMarked
public record CheckResult(CheckOutcome outcome, String code, Map<String, String> parameters) {

    public CheckResult(CheckOutcome outcome, String code, @Nullable Map<String, String> parameters) {
        this.outcome = outcome;
        this.code = code;
        this.parameters = parameters == null ? Map.of() : Map.copyOf(parameters);
    }

    public static CheckResult passed(String code, Map<String, String> parameters) {
        return new CheckResult(CheckOutcome.PASSED, code, parameters);
    }

    public static CheckResult failed(String code, Map<String, String> parameters) {
        return new CheckResult(CheckOutcome.FAILED, code, parameters);
    }

    public static CheckResult skipped(String code, Map<String, String> parameters) {
        return new CheckResult(CheckOutcome.SKIPPED, code, parameters);
    }

    public static CheckResult manual(String code) {
        return new CheckResult(CheckOutcome.MANUAL, code, Map.of());
    }
}
