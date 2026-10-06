package org.courtside.identity.internal;

import org.courtside.securityassessment.SecuritySessionAttributeProjection;
import org.courtside.identity.Person;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextImpl;
import org.springframework.security.web.authentication.WebAuthenticationDetails;
import tools.jackson.databind.json.JsonMapper;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.ObjectOutputStream;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class SecuritySessionAttributeProjectionProducerTest {
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private static byte[] input(Object value) throws IOException {
        var bytes = new ByteArrayOutputStream();
        try (var stream = new ObjectOutputStream(bytes)) {
            stream.writeObject(value);
        }
        return JSON.writeValueAsBytes(Map.of("attributes", List.of(Map.of("name", "SPRING_SECURITY_CONTEXT",
                "attributeBytes", "\\x" + HexFormat.of().formatHex(bytes.toByteArray())))));
    }

    private static UsernamePasswordAuthenticationToken token() {
        var principal = new CourtsideUserDetails(UUID.fromString("12345678-1234-1234-1234-123456789abc"),
                "jane.doe", "private-password-marker", true, true, List.of("ROLE_MEMBER", "ROLE_ADMIN"), 7L);
        return UsernamePasswordAuthenticationToken.authenticated(principal, "private-credential-marker", principal.getAuthorities());
    }

    @Test
    void givenRealLoginProducer_whenJdbcSessionBytesAreProjected_thenPasswordFactorIsPreservedAndCredentialsWereErasedByManager() throws Exception {
        // given
        var encoder = new org.springframework.security.crypto.argon2.Argon2PasswordEncoder(16, 32, 1, 19456, 2);
        var password = "private-password-marker";
        var account = new UserAccount(new Person("Jane", "Doe", "jane@example.org"), "jane.doe",
                encoder.encode(password), java.util.Set.of(Role.ADMIN, Role.MEMBER), "en");
        account.enable();
        var accounts = mock(UserAccountRepository.class);
        when(accounts.findByUsername("jane.doe")).thenReturn(java.util.Optional.of(account));
        var service = new CourtsideUserDetailsService(accounts, new UnusablePassword(encoder),
                mock(PasswordRehashWriter.class), new io.micrometer.core.instrument.simple.SimpleMeterRegistry(), java.time.Clock.systemUTC());
        var provider = new org.springframework.security.authentication.dao.DaoAuthenticationProvider(service);
        provider.setPasswordEncoder(encoder);
        provider.setUserDetailsPasswordService(service);
        var manager = new org.springframework.security.authentication.ProviderManager(provider);
        // when
        var loginStartedAt = java.time.Instant.now();
        var authentication = manager.authenticate(UsernamePasswordAuthenticationToken.unauthenticated("jane.doe", password));
        var loginEndedAt = java.time.Instant.now();
        var bytes = new org.springframework.core.serializer.support.SerializingConverter().convert(new SecurityContextImpl(authentication));
        var request = JSON.writeValueAsBytes(Map.of("attributes", List.of(Map.of("name", "SPRING_SECURITY_CONTEXT",
                "attributeBytes", "\\x" + HexFormat.of().formatHex(bytes)))));
        var result = JSON.readTree(SecuritySessionAttributeProjection.project(request));
        // then
        assertThat(authentication.getCredentials()).isNull();
        assertThat(((CourtsideUserDetails) authentication.getPrincipal()).getPassword()).isNull();
        var value = result.get("attributes").get(0).get("value");
        assertThat(value.get("authorities")).isEqualTo(JSON.readTree("[\"FACTOR_PASSWORD\",\"ROLE_ADMIN\",\"ROLE_MEMBER\"]"));
        assertThat(value.has("passwordFactorIssuedAt")).isTrue();
        var passwordFactor = authentication.getAuthorities().stream()
                .filter(org.springframework.security.core.authority.FactorGrantedAuthority.class::isInstance)
                .map(org.springframework.security.core.authority.FactorGrantedAuthority.class::cast).findFirst().orElseThrow();
        assertThat(passwordFactor.getAuthority()).isEqualTo(org.springframework.security.core.authority.FactorGrantedAuthority.PASSWORD_AUTHORITY);
        assertThat(passwordFactor.getIssuedAt()).isBetween(loginStartedAt, loginEndedAt);
        assertThat(value.get("passwordFactorIssuedAt").asString()).isEqualTo(passwordFactor.getIssuedAt().toString());
        assertThat(value.get("principalAuthorities")).isEqualTo(JSON.readTree("[\"ROLE_ADMIN\",\"ROLE_MEMBER\"]"));
        assertThat(value.get("principalClass").asString()).isEqualTo(CourtsideUserDetails.class.getName());
        assertThat(value.get("accountId").asString()).isEqualTo(account.getId().toString());
        assertThat(value.get("credentials").isNull()).isTrue();
        assertThat(value.get("principalPassword").isNull()).isTrue();
        assertThat(result.toString()).doesNotContain(password, account.getPasswordHash(), "attributeBytes");
    }

    @Test
    void givenPasswordFactorWithNanoseconds_whenProjected_thenExactOriginalIssuedAtIsExposedForCausalComparison() throws Exception {
        // given
        var source = token();
        source.eraseCredentials();
        var issuedAt = java.time.Instant.parse("2099-01-02T03:04:05.123456789Z");
        var factor = org.springframework.security.core.authority.FactorGrantedAuthority.withAuthority(
                org.springframework.security.core.authority.FactorGrantedAuthority.PASSWORD_AUTHORITY).issuedAt(issuedAt).build();
        var authorities = new java.util.ArrayList<org.springframework.security.core.GrantedAuthority>(source.getAuthorities());
        authorities.add(factor);
        var authentication = UsernamePasswordAuthenticationToken.authenticated(source.getPrincipal(), null, authorities);
        // when
        var result = JSON.readTree(SecuritySessionAttributeProjection.project(input(new SecurityContextImpl(authentication))));
        // then
        var value = result.get("attributes").get(0).get("value");
        assertThat(value.has("passwordFactorIssuedAt")).isTrue();
        assertThat(value.get("passwordFactorIssuedAt").asString()).isEqualTo("2099-01-02T03:04:05.123456789Z");
        assertThat(value.get("principalAuthorities")).isEqualTo(JSON.readTree("[\"ROLE_ADMIN\",\"ROLE_MEMBER\"]"));
    }

    @Test
    void givenUnknownDuplicateOrInvalidPasswordFactor_whenProjected_thenFailsClosed() throws Exception {
        // given
        var source = token();
        source.eraseCredentials();
        var valid = org.springframework.security.core.authority.FactorGrantedAuthority.fromAuthority(
                org.springframework.security.core.authority.FactorGrantedAuthority.PASSWORD_AUTHORITY);
        var unknown = org.springframework.security.core.authority.FactorGrantedAuthority.fromAuthority(
                org.springframework.security.core.authority.FactorGrantedAuthority.OTT_AUTHORITY);
        var invalid = org.springframework.security.core.authority.FactorGrantedAuthority.withAuthority(
                org.springframework.security.core.authority.FactorGrantedAuthority.PASSWORD_AUTHORITY)
                .issuedAt(java.time.Instant.ofEpochSecond(-1)).build();
        // when / then
        for (var factors : List.of(List.of(unknown), List.of(valid, valid), List.of(invalid))) {
            var authorities = new java.util.ArrayList<org.springframework.security.core.GrantedAuthority>(source.getAuthorities());
            authorities.addAll(factors);
            var authentication = UsernamePasswordAuthenticationToken.authenticated(source.getPrincipal(), null, authorities);
            var request = input(new SecurityContextImpl(authentication));
            assertThatThrownBy(() -> SecuritySessionAttributeProjection.project(request)).isInstanceOf(IOException.class)
                    .hasMessage("session-attribute-projection-rejected");
        }
    }

    @Test
    void givenLegacyErasedPrincipal_whenProjected_thenAbsentPasswordFactorIsExplicit() throws Exception {
        // given
        var token = token();
        token.eraseCredentials();
        // when
        var result = JSON.readTree(SecuritySessionAttributeProjection.project(input(new SecurityContextImpl(token))));
        // then
        var value = result.get("attributes").get(0).get("value");
        assertThat(value).isEqualTo(JSON.readTree("""
                {"contextClass":"org.springframework.security.core.context.SecurityContextImpl",
                 "authenticationClass":"org.springframework.security.authentication.UsernamePasswordAuthenticationToken",
                 "principalClass":"org.courtside.identity.internal.CourtsideUserDetails",
                 "authenticated":true,"accountId":"12345678-1234-1234-1234-123456789abc",
                 "username":"jane.doe","securityEpoch":7,"authorities":["ROLE_ADMIN","ROLE_MEMBER"],
                 "principalAuthorities":["ROLE_ADMIN","ROLE_MEMBER"],"passwordFactorIssuedAt":null,
                 "credentials":null,"details":null,"principalPassword":null,"enabled":true,
                 "accountNonExpired":true,"accountNonLocked":true,"credentialsNonExpired":true}
                """));
        assertThat(result.toString()).doesNotContain("private-password-marker", "private-credential-marker", "attributeBytes");
    }

    @Test
    void givenActualPrincipalAndSessionAttributes_whenProjected_thenAllThreeNativeValuesAreSupported() throws Exception {
        // given
        var token = token();
        token.eraseCredentials();
        var attributes = new java.util.ArrayList<Map<String, String>>();
        var values = new java.util.LinkedHashMap<String, Object>();
        values.put("SPRING_SECURITY_CONTEXT", new SecurityContextImpl(token));
        values.put("courtside.authenticated-at", 1778580000000L);
        values.put("courtside.browser-family", "FIREFOX");
        for (var entry : values.entrySet()) {
            var bytes = new ByteArrayOutputStream();
            try (var stream = new ObjectOutputStream(bytes)) {
                stream.writeObject(entry.getValue());
            }
            attributes.add(Map.of("name", entry.getKey(), "attributeBytes", "\\x" + HexFormat.of().formatHex(bytes.toByteArray())));
        }
        // when
        var result = JSON.readTree(SecuritySessionAttributeProjection.project(JSON.writeValueAsBytes(Map.of("attributes", attributes))));
        // then
        assertThat(result.get("attributes").size()).isEqualTo(3);
        assertThat(result.get("attributes").get(1).get("value").get("value").asLong()).isEqualTo(1778580000000L);
        assertThat(result.get("attributes").get(2).get("value").get("value").asString()).isEqualTo("FIREFOX");
    }

    @Test
    void givenUnErasedCredentialsOrPrincipal_whenProjected_thenRejectedWithoutSecretInError() throws Exception {
        // given
        var token = token();
        var request = input(new SecurityContextImpl(token));
        // when / then
        assertThatThrownBy(() -> SecuritySessionAttributeProjection.project(request)).isInstanceOf(IOException.class)
                .hasMessage("session-attribute-projection-rejected");
        var principal = token.getPrincipal();
        var credentialFreeToken = UsernamePasswordAuthenticationToken.authenticated(principal, null, token.getAuthorities());
        var secondRequest = input(new SecurityContextImpl(credentialFreeToken));
        assertThatThrownBy(() -> SecuritySessionAttributeProjection.project(secondRequest)).isInstanceOf(IOException.class);
    }

    @Test
    void givenActualWebDetails_whenProjected_thenFixedDetailsFieldsMatch() throws Exception {
        // given
        var token = token();
        token.eraseCredentials();
        token.setDetails(new WebAuthenticationDetails("127.0.0.1", null));
        // when
        var result = JSON.readTree(SecuritySessionAttributeProjection.project(input(new SecurityContextImpl(token))));
        // then
        assertThat(result.get("attributes").get(0).get("value").get("details")).isEqualTo(JSON.readTree(
                "{\"className\":\"org.springframework.security.web.authentication.WebAuthenticationDetails\",\"remoteAddress\":\"127.0.0.1\",\"sessionId\":null}"));
    }

    @Test
    void givenGenericUserOrUnknownPrincipalSubclass_whenProjected_thenNotAcceptedAsCourtsidePrincipal() throws Exception {
        // given
        var user = new org.springframework.security.core.userdetails.User("jane.doe", "private-password-marker", List.of());
        user.eraseCredentials();
        var generic = UsernamePasswordAuthenticationToken.authenticated(user, null, user.getAuthorities());
        var request = input(new SecurityContextImpl(generic));
        // when / then
        assertThatThrownBy(() -> SecuritySessionAttributeProjection.project(request)).isInstanceOf(IOException.class);
        var unknown = UsernamePasswordAuthenticationToken.authenticated(new UnknownUser(), null, List.of());
        var secondRequest = input(new SecurityContextImpl(unknown));
        assertThatThrownBy(() -> SecuritySessionAttributeProjection.project(secondRequest)).isInstanceOf(IOException.class);
    }

    @Test
    void givenUnknownDetailsOrMissingAuthentication_whenProjected_thenRejected() throws Exception {
        // given
        var token = token();
        token.eraseCredentials();
        token.setDetails("private-detail-marker");
        var request = input(new SecurityContextImpl(token));
        // when / then
        assertThatThrownBy(() -> SecuritySessionAttributeProjection.project(request)).isInstanceOf(IOException.class);
        var empty = input(new SecurityContextImpl());
        assertThatThrownBy(() -> SecuritySessionAttributeProjection.project(empty)).isInstanceOf(IOException.class);
    }

    private static final class UnknownUser extends org.springframework.security.core.userdetails.User {
        private UnknownUser() {
            super("jane.doe", "private-password-marker", List.of());
        }
    }
}
