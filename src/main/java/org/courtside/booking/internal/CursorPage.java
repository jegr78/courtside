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
        UUID nextCursor = idsIncludingProbe.size() > limit ? idsIncludingProbe.get(limit - 1) : null;
        List<UUID> visibleIds = idsIncludingProbe.stream().limit(limit).toList();
        Map<UUID, T> found = load.apply(visibleIds).stream().collect(Collectors.toMap(idOf, item -> item));
        return new Result<>(visibleIds.stream().map(found::get).filter(Objects::nonNull).toList(), nextCursor);
    }

    public record Result<T>(List<T> items, UUID nextCursor) {

        public Result {
            items = List.copyOf(items);
        }
    }
}
