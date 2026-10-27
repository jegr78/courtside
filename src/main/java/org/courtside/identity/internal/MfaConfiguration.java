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

import java.nio.file.Path;

@Configuration(proxyBeanMethods = false)
class MfaConfiguration {
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
