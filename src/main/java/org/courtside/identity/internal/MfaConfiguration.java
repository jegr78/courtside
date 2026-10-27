package org.courtside.identity.internal;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;

import java.nio.file.Path;

@Configuration(proxyBeanMethods = false)
class MfaConfiguration {
    @Bean
    MfaSecrets mfaSecrets(JdbcClient jdbc, PlatformTransactionManager transactions,
                          @Value("${courtside.mfa.key-root}") Path root,
                          @Value("${courtside.mfa.key-file:}") String suppliedFile) {
        return new MfaSecrets(jdbc, transactions, root,
                suppliedFile.isBlank() ? null : Path.of(suppliedFile));
    }

    @Bean
    ApplicationRunner validateMfaKeys(MfaSecrets secrets) {
        return arguments -> secrets.initialize();
    }
}
