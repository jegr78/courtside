package org.courtside.identity.internal;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;

import static org.assertj.core.api.Assertions.assertThat;

class LoginProtectionPropertiesTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withUserConfiguration(PropertiesConfiguration.class)
            .withPropertyValues(
                    "courtside.login-protection.address.max-failures=20",
                    "courtside.login-protection.address.window=1m",
                    "courtside.login-protection.address.block=1m",
                    "courtside.login-protection.global.threshold=100",
                    "courtside.login-protection.global.window=1m");

    @Test
    void givenPositiveVerificationCapacity_whenBindingConfiguration_thenItStarts() {
        contextRunner.withPropertyValues("courtside.login-protection.verification-concurrency=2")
                .run(context -> assertThat(context).hasNotFailed());
    }

    @ParameterizedTest
    @ValueSource(ints = {0, -1})
    void givenNonPositiveVerificationCapacity_whenBindingConfiguration_thenStartupFailsClosed(int capacity) {
        contextRunner.withPropertyValues("courtside.login-protection.verification-concurrency=" + capacity)
                .run(context -> {
                    assertThat(context).hasFailed();
                    assertThat(context.getStartupFailure()).rootCause()
                            .hasMessageContaining("verificationConcurrency");
                });
    }

    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(LoginProtectionProperties.class)
    static class PropertiesConfiguration {
    }
}
