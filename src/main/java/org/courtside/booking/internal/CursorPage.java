package org.courtside.booking.internal;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

public final class CursorPage {

    private CursorPage() {
    }

    public static <T> Result<T> of(
            List<UUID> idsIncludingProbe, int limit, Function<List<UUID>, List<T>> load, Function<T, UUID> idOf) {
        boolean hasProbe = idsIncludingProbe.size() > limit;
        Map<UUID, T> found = load.apply(idsIncludingProbe).stream()
                .collect(Collectors.toMap(idOf, item -> item));
        List<T> items = idsIncludingProbe.stream()
                .map(found::get)
                .filter(Objects::nonNull)
                .limit(limit)
                .toList();
        UUID nextCursor = hasProbe && !items.isEmpty() ? idOf.apply(items.getLast()) : null;
        return new Result<>(items, nextCursor);
    }

    public record Result<T>(List<T> items, UUID nextCursor) {

        public Result {
            items = List.copyOf(items);
        }
    }
}
