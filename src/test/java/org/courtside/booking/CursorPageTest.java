package org.courtside.booking;

import org.courtside.booking.internal.CursorPage;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class CursorPageTest {

    private final UUID first = UUID.randomUUID();
    private final UUID second = UUID.randomUUID();
    private final UUID third = UUID.randomUUID();

    @Test
    void givenMoreIdsThanTheLimit_whenPaging_thenTheLastVisibleIdIsTheCursor() {
        // given
        List<UUID> ids = List.of(first, second, third);

        // when
        CursorPage.Result<Item> page = CursorPage.of(ids, 2, this::loadInAnyOrder, Item::id);

        // then
        assertThat(page.items()).extracting(Item::id).containsExactly(first, second);
        assertThat(page.nextCursor()).isEqualTo(second);
    }

    @Test
    void givenExactlyTheLimit_whenPaging_thenThereIsNoCursor() {
        // when
        CursorPage.Result<Item> page = CursorPage.of(List.of(first, second), 2, this::loadInAnyOrder, Item::id);

        // then
        assertThat(page.nextCursor()).isNull();
    }

    @Test
    void givenALoaderThatReturnsAnotherOrder_whenPaging_thenTheIdOrderIsRestored() {
        // when
        CursorPage.Result<Item> page = CursorPage.of(List.of(first, second), 2, this::loadReversed, Item::id);

        // then
        assertThat(page.items()).extracting(Item::id).containsExactly(first, second);
    }

    private List<Item> loadInAnyOrder(List<UUID> ids) {
        return ids.stream().map(Item::new).toList();
    }

    private List<Item> loadReversed(List<UUID> ids) {
        return loadInAnyOrder(ids).reversed();
    }

    private record Item(UUID id) {
    }
}
