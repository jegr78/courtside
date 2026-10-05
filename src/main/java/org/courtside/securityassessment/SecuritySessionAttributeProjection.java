package org.courtside.securityassessment;

import org.courtside.shared.SecurityEventPrincipal;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.authority.FactorGrantedAuthority;
import org.springframework.security.core.context.SecurityContextImpl;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.web.authentication.WebAuthenticationDetails;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.ObjectInputFilter;
import java.io.ObjectInputStream;
import java.io.ObjectStreamClass;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class SecuritySessionAttributeProjection {
    private static final int MAX_INPUT_BYTES = 262144;
    private static final int MAX_ATTRIBUTE_BYTES = 65536;
    private static final long MAX_SAFE_INTEGER = 9007199254740991L;
    private static final String PRINCIPAL_CLASS = "org.courtside.identity.internal.CourtsideUserDetails";
    private static final String REJECTION = "session-attribute-projection-rejected";
    private static final Set<String> NAMES = Set.of("SPRING_SECURITY_CONTEXT", "courtside.authenticated-at", "courtside.browser-family");
    private static final Set<String> BROWSER_FAMILIES = Set.of("CHROME", "EDGE", "FIREFOX", "SAFARI", "OTHER");
    private static final Set<String> CLASSES = Set.of(
            "org.springframework.security.core.context.SecurityContextImpl",
            "org.springframework.security.authentication.UsernamePasswordAuthenticationToken",
            "org.springframework.security.authentication.AbstractAuthenticationToken",
            PRINCIPAL_CLASS, "org.springframework.security.core.userdetails.User",
            "org.springframework.security.core.userdetails.User$AuthorityComparator",
            "org.springframework.security.core.authority.SimpleGrantedAuthority",
            "org.springframework.security.core.authority.FactorGrantedAuthority",
            "java.time.Ser", "java.time.Instant",
            "org.springframework.security.web.authentication.WebAuthenticationDetails",
            "java.util.UUID", "java.lang.Long", "java.lang.Number", "java.lang.String",
            "java.util.ArrayList", "java.util.TreeSet", "java.util.Collections$UnmodifiableSet",
            "java.util.Collections$UnmodifiableCollection", "java.util.Collections$UnmodifiableList",
            "java.util.Collections$UnmodifiableRandomAccessList", "[Ljava.lang.Object;");
    private static final JsonMapper JSON = JsonMapper.builder()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();

    private SecuritySessionAttributeProjection() {
    }

    public static void main(String[] args) {
        try {
            if (args.length != 0) throw rejected();
            System.out.write(project(System.in.readNBytes(MAX_INPUT_BYTES + 1)));
            System.out.write('\n');
        } catch (Exception exception) {
            System.err.println(REJECTION);
            System.exit(1);
        }
    }

    public static byte[] project(byte[] input) throws IOException {
        try {
            if (input == null || input.length == 0 || input.length > MAX_INPUT_BYTES) throw rejected();
            var root = JSON.readTree(input);
            if (root == null || !root.isObject() || root.size() != 1 || !root.has("attributes")) throw rejected();
            var attributes = root.get("attributes");
            if (!attributes.isArray() || attributes.isEmpty() || attributes.size() > NAMES.size()) throw rejected();
            var seen = new HashSet<String>();
            var projections = new ArrayList<Map<String, Object>>();
            for (var attribute : attributes) {
                if (!attribute.isObject() || attribute.size() != 2) throw rejected();
                var name = text(attribute.get("name"), 64);
                if (!NAMES.contains(name) || !seen.add(name)) throw rejected();
                var hex = text(attribute.get("attributeBytes"), MAX_ATTRIBUTE_BYTES * 2 + 2);
                if (!hex.startsWith("\\x") || hex.length() < 4 || hex.length() % 2 != 0) throw rejected();
                for (int index = 2; index < hex.length(); index++) {
                    char digit = hex.charAt(index);
                    if (!(digit >= '0' && digit <= '9' || digit >= 'a' && digit <= 'f')) throw rejected();
                }
                var bytes = HexFormat.of().parseHex(hex.substring(2));
                var value = decode(bytes);
                projections.add(Map.of("decoder", "spring-jdbc-java-serialization-v1", "name", name,
                        "bytesDigest", "sha256:" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)),
                        "value", projectValue(name, value)));
            }
            return JSON.writeValueAsBytes(Map.of("attributes", projections));
        } catch (Exception exception) {
            throw rejected();
        }
    }

    private static Object decode(byte[] bytes) throws IOException, ClassNotFoundException {
        try (var source = new ByteArrayInputStream(bytes); var stream = new RestrictedStream(source)) {
            stream.setObjectInputFilter(info -> {
                if (info.depth() > 16 || info.references() > 256 || info.streamBytes() > MAX_ATTRIBUTE_BYTES
                        || info.arrayLength() > 64) return ObjectInputFilter.Status.REJECTED;
                if (info.serialClass() == null) return ObjectInputFilter.Status.UNDECIDED;
                return CLASSES.contains(info.serialClass().getName())
                        ? ObjectInputFilter.Status.ALLOWED : ObjectInputFilter.Status.REJECTED;
            });
            var value = stream.readObject();
            if (source.available() != 0) throw rejected();
            return value;
        }
    }

    private static Map<String, Object> projectValue(String name, Object value) throws ReflectiveOperationException, IOException {
        if (value == null) throw rejected();
        return switch (name) {
            case "courtside.authenticated-at" -> {
                if (value.getClass() != Long.class || (Long) value < 0 || (Long) value > MAX_SAFE_INTEGER) throw rejected();
                yield Map.of("className", "java.lang.Long", "value", value);
            }
            case "courtside.browser-family" -> {
                if (value.getClass() != String.class || !BROWSER_FAMILIES.contains(value)) throw rejected();
                yield Map.of("className", "java.lang.String", "value", value);
            }
            case "SPRING_SECURITY_CONTEXT" -> context(value);
            default -> throw rejected();
        };
    }

    private static Map<String, Object> context(Object value) throws ReflectiveOperationException, IOException {
        if (value.getClass() != SecurityContextImpl.class) throw rejected();
        var authentication = ((SecurityContextImpl) value).getAuthentication();
        if (authentication == null || authentication.getClass() != UsernamePasswordAuthenticationToken.class
                || authentication.getCredentials() != null) throw rejected();
        var principal = authentication.getPrincipal();
        if (principal == null || !principal.getClass().getName().equals(PRINCIPAL_CLASS)
                || !(principal instanceof User user) || user.getPassword() != null
                || !(principal instanceof SecurityEventPrincipal eventPrincipal)) throw rejected();
        var epochAccessor = principal.getClass().getDeclaredMethod("securityEpoch");
        if (epochAccessor.getReturnType() != long.class || !epochAccessor.trySetAccessible()) throw rejected();
        long epoch = (Long) epochAccessor.invoke(principal);
        if (epoch < 0 || epoch > MAX_SAFE_INTEGER || eventPrincipal.securityEventAccountId() == null
                || user.getUsername() == null || user.getUsername().length() > 256) throw rejected();
        var principalAuthorities = authorities(user.getAuthorities());
        var authorities = authenticationAuthorities(authentication.getAuthorities(), principalAuthorities);
        var result = new LinkedHashMap<String, Object>();
        result.put("contextClass", value.getClass().getName());
        result.put("authenticationClass", authentication.getClass().getName());
        result.put("principalClass", PRINCIPAL_CLASS);
        result.put("authenticated", authentication.isAuthenticated());
        result.put("accountId", eventPrincipal.securityEventAccountId().toString());
        result.put("username", user.getUsername());
        result.put("securityEpoch", epoch);
        result.put("authorities", authorities);
        result.put("principalAuthorities", principalAuthorities);
        result.put("passwordFactorIssuedAt", authentication.getAuthorities().stream()
                .filter(authority -> authority.getClass() == FactorGrantedAuthority.class)
                .map(authority -> ((FactorGrantedAuthority) authority).getIssuedAt().toString())
                .findFirst().orElse(null));
        result.put("credentials", null);
        result.put("details", details(authentication.getDetails()));
        result.put("principalPassword", null);
        result.put("enabled", user.isEnabled());
        result.put("accountNonExpired", user.isAccountNonExpired());
        result.put("accountNonLocked", user.isAccountNonLocked());
        result.put("credentialsNonExpired", user.isCredentialsNonExpired());
        return result;
    }

    private static List<String> authorities(java.util.Collection<? extends org.springframework.security.core.GrantedAuthority> values)
            throws IOException {
        if (values == null || values.size() > 32) throw rejected();
        var result = new ArrayList<String>();
        for (var value : values) {
            if (value == null || value.getClass() != SimpleGrantedAuthority.class || value.getAuthority() == null
                    || value.getAuthority().length() > 64 || result.contains(value.getAuthority())) throw rejected();
            result.add(value.getAuthority());
        }
        result.sort(String::compareTo);
        return result;
    }

    private static List<String> authenticationAuthorities(
            java.util.Collection<? extends org.springframework.security.core.GrantedAuthority> values,
            List<String> principalAuthorities) throws IOException {
        if (values == null || values.size() > 32) throw rejected();
        var roles = new ArrayList<org.springframework.security.core.GrantedAuthority>();
        var result = new ArrayList<String>();
        String passwordFactorIssuedAt = null;
        for (var value : values) {
            if (value != null && value.getClass() == FactorGrantedAuthority.class) {
                var factor = (FactorGrantedAuthority) value;
                if (passwordFactorIssuedAt != null || !FactorGrantedAuthority.PASSWORD_AUTHORITY.equals(factor.getAuthority())
                        || factor.getIssuedAt() == null || factor.getIssuedAt().getClass() != java.time.Instant.class
                        || factor.getIssuedAt().isBefore(java.time.Instant.EPOCH)
                        || factor.getIssuedAt().getEpochSecond() > MAX_SAFE_INTEGER / 1000) throw rejected();
                passwordFactorIssuedAt = factor.getIssuedAt().toString();
                result.add(factor.getAuthority());
            } else {
                roles.add(value);
            }
        }
        var projectedRoles = authorities(roles);
        if (!projectedRoles.equals(principalAuthorities) || projectedRoles.contains(FactorGrantedAuthority.PASSWORD_AUTHORITY)) throw rejected();
        result.addAll(projectedRoles);
        result.sort(String::compareTo);
        return List.copyOf(result);
    }

    private static Map<String, Object> details(Object value) throws IOException {
        if (value == null) return null;
        if (value.getClass() != WebAuthenticationDetails.class) throw rejected();
        var details = (WebAuthenticationDetails) value;
        if (details.getRemoteAddress() == null || details.getRemoteAddress().length() > 64
                || details.getSessionId() != null && !details.getSessionId().matches("[A-Za-z0-9_-]{36}")) throw rejected();
        var result = new LinkedHashMap<String, Object>();
        result.put("className", value.getClass().getName());
        result.put("remoteAddress", details.getRemoteAddress());
        result.put("sessionId", details.getSessionId());
        return result;
    }

    private static String text(JsonNode value, int maxLength) throws IOException {
        if (value == null || !value.isString() || value.asString().length() > maxLength) throw rejected();
        return value.asString();
    }

    private static IOException rejected() {
        return new IOException(REJECTION);
    }

    private static final class RestrictedStream extends ObjectInputStream {
        private RestrictedStream(InputStream source) throws IOException {
            super(source);
        }

        @Override
        protected Class<?> resolveClass(ObjectStreamClass descriptor) throws IOException, ClassNotFoundException {
            if (!CLASSES.contains(descriptor.getName())) throw rejected();
            return super.resolveClass(descriptor);
        }

        @Override
        protected Class<?> resolveProxyClass(String[] interfaces) throws IOException {
            throw rejected();
        }
    }
}
