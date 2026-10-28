package org.courtside.identity.internal;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.ProviderManager;
import org.springframework.security.authentication.DefaultAuthenticationEventPublisher;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.nio.file.Files;
import java.nio.file.Path;

@Configuration(proxyBeanMethods = false)
class MfaConfiguration {
    static final Path IMAGE_KEY_ROOT = Path.of("/var/lib/courtside/mfa-keys");
    static final Path LOCAL_KEY_ROOT = Path.of(".courtside/keys");

    static Path keyRoot(String configured, Path image) {
        if (configured != null && !configured.isBlank()) return Path.of(configured.strip());
        return Files.isDirectory(image) ? image : LOCAL_KEY_ROOT;
    }

    @Bean
    AuthenticationManager accountAuthenticationManager(CourtsideUserDetailsService users,
                                                         PasswordEncoder passwords, MfaFactors factors,
                                                         ApplicationEventPublisher events) {
        DaoAuthenticationProvider password = new DaoAuthenticationProvider(users);
        password.setPasswordEncoder(passwords);
        password.setUserDetailsPasswordService(users);
        ProviderManager manager = new ProviderManager(new MfaPasswordAuthenticationProvider(password, factors));
        manager.setAuthenticationEventPublisher(new DefaultAuthenticationEventPublisher(events));
        return manager;
    }

    @Bean
    MfaSecrets mfaSecrets(JdbcClient jdbc, PlatformTransactionManager transactions,
                          @Value("${courtside.mfa.key-root:}") String root,
                          @Value("${courtside.mfa.key-file:}") String suppliedFile) {
        return new MfaSecrets(jdbc, transactions, keyRoot(root, IMAGE_KEY_ROOT),
                suppliedFile.isBlank() ? null : Path.of(suppliedFile));
    }

    @Bean
    ApplicationRunner validateMfaKeys(MfaSecrets secrets, MfaKeysHealth health) {
        return arguments -> {
            secrets.initialize();
            health.validated();
        };
    }
}
