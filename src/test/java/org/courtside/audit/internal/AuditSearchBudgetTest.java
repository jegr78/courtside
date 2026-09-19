package org.courtside.audit.internal;

import org.courtside.identity.UserAccountRepository;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Limit;
import tools.jackson.databind.json.JsonMapper;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AuditSearchBudgetTest {

    @Test
    void givenNoTextMatch_whenTheScanBudgetIsReached_thenThePageSaysItIsIncomplete() {
        // given
        DomainEventRepository events = mock(DomainEventRepository.class);
        UserAccountRepository accounts = mock(UserAccountRepository.class);
        List<DomainEvent> batch = java.util.stream.IntStream.range(0, 250)
                .mapToObj(index -> new DomainEvent("test.recorded", UUID.randomUUID(), null,
                        Instant.parse("2026-09-19T09:00:00Z").minusSeconds(index), "{}"))
                .toList();
        List<UUID> ids = batch.stream().map(DomainEvent::getId).toList();
        when(events.findSearchCandidates(isNull(), isNull(), isNull(), isNull(),
                nullable(Instant.class), nullable(UUID.class), any(Limit.class))).thenReturn(ids);
        when(events.findAllByIdIn(any())).thenReturn(batch);
        when(accounts.findAllById(any())).thenReturn(List.of());
        AuditService service = new AuditService(events, accounts, List.of(), JsonMapper.builder().build());

        // when
        AuditService.SearchResult result = service.search("not present", null, null,
                null, null, null, 50);

        // then
        assertThat(result.items()).isEmpty();
        assertThat(result.incomplete()).isTrue();
        verify(events, times(10)).findSearchCandidates(isNull(), isNull(), isNull(), isNull(),
                nullable(Instant.class), nullable(UUID.class), any(Limit.class));
    }
}
