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
    private FilterChainProxy chain;

    @Test
    void whenTheChainIsBuilt_thenTheSessionFiltersRunBeforeAuthorityIsRead() {
        // given
        List<String> names = chain.getFilterChains().stream()
                .flatMap(filterChain -> ((SecurityFilterChain) filterChain).getFilters().stream())
                .map(filter -> filter.getClass().getSimpleName())
                .toList();

        // when / then
        assertThat(names).contains("AbsoluteSessionLifetimeFilter", "SecurityEpochFilter");
        assertThat(names.indexOf("SecurityContextHolderFilter"))
                .isLessThan(names.indexOf("AbsoluteSessionLifetimeFilter"));
        assertThat(names.indexOf("AbsoluteSessionLifetimeFilter"))
                .as("authority is read after this filter has had its say")
                .isLessThan(names.indexOf("AuthorizationFilter"));
    }
}
