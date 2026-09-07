package org.courtside;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

@TestConfiguration(proxyBeanMethods = false)
public class SafePasswordLookupConfiguration {

    @Bean
    @Primary
    org.courtside.identity.internal.BreachedPasswordLookup safePasswordLookup() {
        return password -> false;
    }
}
