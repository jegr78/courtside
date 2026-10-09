package org.courtside.securityassessment;

import org.courtside.shared.BookingConfirmed;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalApplicationListenerMethodAdapter;
import tools.jackson.databind.json.JsonMapper;

import java.lang.reflect.Modifier;
import java.lang.reflect.Proxy;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;

public final class SecurityPublicationPolicyProjection {
    private static final String LISTENER_CLASS = "org.courtside.notification.internal.BookingMailer";
    private static final String REJECTION = "publication-policy-projection-rejected";
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private SecurityPublicationPolicyProjection() {
    }

    public static void main(String[] args) {
        try {
            System.out.write(project(args));
            System.out.write('\n');
        } catch (Exception exception) {
            System.err.println(REJECTION);
            System.exit(1);
        }
    }

    public static byte[] project(String[] args) {
        try {
            if (args == null || args.length != 0) throw rejected();
            var listener = Class.forName(LISTENER_CLASS, false, SecurityPublicationPolicyProjection.class.getClassLoader());
            var method = listener.getDeclaredMethod("on", BookingConfirmed.class);
            if (method.getDeclaringClass() != listener || method.getReturnType() != void.class
                    || Modifier.isStatic(method.getModifiers()) || method.isBridge() || method.isSynthetic()) {
                throw rejected();
            }
            var adapter = new TransactionalApplicationListenerMethodAdapter("bookingMailer", listener, method);
            var listenerId = adapter.getListenerId();
            if (adapter.getTransactionPhase() != TransactionPhase.BEFORE_COMMIT
                    || listenerId.isBlank() || listenerId.length() > 512
                    || listenerId.chars().anyMatch(character -> character < 32 || character > 126)) {
                throw rejected();
            }
            var serializerClass = Class.forName("org.springframework.modulith.events.core.EventSerializer", false, getLoader());
            var serializer = Proxy.newProxyInstance(getLoader(), new Class<?>[]{serializerClass},
                    (proxy, invoked, arguments) -> { throw rejected(); });
            var repository = repository(null, new JdbcTemplate(), serializer);
            if (!repository.getClass().getName().equals("org.springframework.modulith.events.jdbc.JdbcEventPublicationRepositoryV2")) {
                throw rejected();
            }
            byte[] classBytes;
            try (var resource = repository.getClass().getResourceAsStream("JdbcEventPublicationRepositoryV2.class")) {
                if (resource == null) throw rejected();
                classBytes = resource.readNBytes(65537);
                if (classBytes.length == 0 || classBytes.length > 65536) throw rejected();
            }
            var digest = "sha256:" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(classBytes));
            return JSON.writeValueAsBytes(Map.of("listenerId", listenerId, "eventType", BookingConfirmed.class.getName(),
                    "repositoryMode", "JDBC_V2", "repositoryClassDigest", digest));
        } catch (Exception exception) {
            throw rejected();
        }
    }

    private static Object repository(Boolean legacy, JdbcTemplate jdbc, Object serializer) throws Exception {
        var loader = getLoader();
        var propertiesClass = Class.forName("org.springframework.modulith.events.jdbc.JdbcConfigurationProperties", false, loader);
        var initializationClass = Class.forName("org.springframework.modulith.events.jdbc.JdbcConfigurationProperties$SchemaInitialization", false, loader);
        var propertiesConstructor = propertiesClass.getDeclaredConstructor(initializationClass, String.class, Boolean.class);
        propertiesConstructor.setAccessible(true);
        var properties = propertiesConstructor.newInstance(null, null, legacy);
        var databaseClass = Class.forName("org.springframework.modulith.events.jdbc.DatabaseType", false, loader);
        var postgresField = databaseClass.getDeclaredField("POSTGRES");
        postgresField.setAccessible(true);
        var settingsClass = Class.forName("org.springframework.modulith.events.jdbc.JdbcRepositorySettings", false, loader);
        var completionClass = Class.forName("org.springframework.modulith.events.support.CompletionMode", false, loader);
        var settingsConstructor = settingsClass.getDeclaredConstructor(databaseClass, completionClass, propertiesClass);
        settingsConstructor.setAccessible(true);
        var settings = settingsConstructor.newInstance(postgresField.get(null), completionClass.getField("DELETE").get(null), properties);
        var configurationClass = Class.forName("org.springframework.modulith.events.jdbc.JdbcEventPublicationAutoConfiguration", false, loader);
        var constructor = configurationClass.getDeclaredConstructor();
        constructor.setAccessible(true);
        var configuration = constructor.newInstance();
        var serializerClass = Class.forName("org.springframework.modulith.events.core.EventSerializer", false, loader);
        var factory = configurationClass.getDeclaredMethod("jdbcEventPublicationRepository", JdbcTemplate.class, serializerClass, settingsClass);
        factory.setAccessible(true);
        return factory.invoke(configuration, jdbc, serializer, settings);
    }

    private static ClassLoader getLoader() {
        return SecurityPublicationPolicyProjection.class.getClassLoader();
    }

    private static IllegalStateException rejected() {
        return new IllegalStateException(REJECTION);
    }
}
