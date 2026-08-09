package org.courtside.identity.internal;

import org.courtside.identity.Role;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;

@Configuration(proxyBeanMethods = false)
public class SecurityConfiguration {

    // OWASP's Argon2id minimum. Every login costs this much memory, including one for a username
    // that does not exist, and nothing rate-limits that yet — see docs/design.md.
    private static final int MEMORY_IN_KIBIBYTES = 19456;
    private static final int ITERATIONS = 2;
    private static final int PARALLELISM = 1;
    private static final int SALT_LENGTH_IN_BYTES = 16;
    private static final int HASH_LENGTH_IN_BYTES = 32;

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new Argon2PasswordEncoder(SALT_LENGTH_IN_BYTES, HASH_LENGTH_IN_BYTES,
                PARALLELISM, MEMORY_IN_KIBIBYTES, ITERATIONS);
    }

    @Bean
    public SecurityFilterChain filterChain(
            HttpSecurity http,
            ProblemDetailAccessDeniedHandler accessDeniedHandler,
            ProblemDetailAuthenticationEntryPoint authenticationEntryPoint,
            @Value("${server.servlet.session.cookie.secure}") boolean secureCookies)
            throws Exception {
        CsrfTokenRequestAttributeHandler csrfHandler = new CsrfTokenRequestAttributeHandler();
        csrfHandler.setCsrfRequestAttributeName(null);

        return http
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/api/public/booking-cards", "/api/public/participant-cards")
                        .authenticated()
                        .requestMatchers("/api/public/**", "/actuator/health").permitAll()
                        // The contract is not a secret and is needed before anyone can
                        // authenticate against it.
                        .requestMatchers("/api/openapi.yaml").permitAll()
                        .requestMatchers("/api/session").permitAll()
                        .requestMatchers("/api/admin/**").hasRole(Role.ADMIN.name())
                        .anyRequest().authenticated())
                .formLogin(form -> form
                        .loginProcessingUrl("/api/session")
                        .successHandler((request, response, authentication) ->
                                response.setStatus(HttpStatus.OK.value()))
                        .failureHandler(authenticationEntryPoint::commence))
                .logout(logout -> logout
                        .logoutUrl("/api/session/logout")
                        .logoutSuccessHandler((request, response, authentication) ->
                                response.setStatus(HttpStatus.NO_CONTENT.value())))
                .exceptionHandling(handling -> handling
                        .authenticationEntryPoint(authenticationEntryPoint)
                        .accessDeniedHandler(accessDeniedHandler))
                .csrf(csrf -> csrf
                        .csrfTokenRepository(csrfTokenRepository(secureCookies))
                        .csrfTokenRequestHandler(csrfHandler))
                .build();
    }

    static CookieCsrfTokenRepository csrfTokenRepository(boolean secureCookies) {
        CookieCsrfTokenRepository repository = CookieCsrfTokenRepository.withHttpOnlyFalse();
        repository.setCookieCustomizer(cookie -> cookie.secure(secureCookies));
        return repository;
    }
}
