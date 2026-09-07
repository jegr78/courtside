package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.web.FilterChainProxy;
import org.springframework.security.web.SecurityFilterChain;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class SecurityFilterChainOrderTest extends AbstractIntegrationTest {

    @Autowired
    private FilterChainProxy proxy;

    @Test
    void whenTheChainIsBuilt_thenTheSessionFiltersRunBeforeAuthorityIsRead() {
        // given — one chain, because positions compared across two of them mean nothing
        List<SecurityFilterChain> chains = proxy.getFilterChains().stream()
                .map(SecurityFilterChain.class::cast)
                .toList();
        assertThat(chains).hasSize(1);
        List<String> names = chains.getFirst().getFilters().stream()
                .map(filter -> filter.getClass().getSimpleName())
                .toList();

        // when / then — named before they are indexed: a filter that is not there answers -1, and
        // -1 comes before everything, so a missing anchor would make the order below pass by itself
        assertThat(names).contains("SecurityContextHolderFilter", "SecurityEpochFilter",
                "AbsoluteSessionLifetimeFilter", "AuthorizationFilter");
        assertThat(names.indexOf("SecurityContextHolderFilter"))
                .isLessThan(names.indexOf("AbsoluteSessionLifetimeFilter"));
        assertThat(names.indexOf("AbsoluteSessionLifetimeFilter"))
                .as("authority is read after this filter has had its say")
                .isLessThan(names.indexOf("AuthorizationFilter"));
    }
}
