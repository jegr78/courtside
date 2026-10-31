package org.courtside.access.internal;

import org.jspecify.annotations.Nullable;
import tools.jackson.databind.JsonNode;

import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/** A Miniserver's config version as {@code jdev/cfg/apiKey} names it, compared segment by segment as numbers. */
record LoxoneVersion(List<Integer> segments) {

    static final LoxoneVersion MINIMUM = new LoxoneVersion(List.of(14, 2, 5, 16));

    private static final Pattern VERSION =
            Pattern.compile("['\"]version['\"]\\s*:\\s*['\"]([0-9]{1,6}(?:\\.[0-9]{1,6})*)['\"]");

    static Optional<LoxoneVersion> of(@Nullable JsonNode value) {
        if (value == null) {
            return Optional.empty();
        }
        Matcher found = VERSION.matcher(value.isString() ? value.asString() : value.toString());
        if (!found.find()) {
            return Optional.empty();
        }
        return Optional.of(new LoxoneVersion(Arrays.stream(found.group(1).split("\\."))
                .map(Integer::parseInt).toList()));
    }

    boolean atLeast(LoxoneVersion minimum) {
        int length = Math.max(segments.size(), minimum.segments().size());
        for (int index = 0; index < length; index++) {
            int compared = Integer.compare(segment(index), minimum.segment(index));
            if (compared != 0) {
                return compared > 0;
            }
        }
        return true;
    }

    private int segment(int index) {
        return index < segments.size() ? segments.get(index) : 0;
    }

    @Override
    public String toString() {
        return segments.stream().map(String::valueOf).collect(Collectors.joining("."));
    }
}
