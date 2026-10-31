package org.courtside.access;

import org.jspecify.annotations.NullMarked;

import java.util.List;
import java.util.function.Supplier;

/** One check a board can ask for; it runs as its own call and is skipped unless each check it requires passed. */
@NullMarked
public record ConnectionCheck(String name, List<String> requires, Supplier<CheckResult> run) {

    public ConnectionCheck {
        requires = List.copyOf(requires);
    }
}
