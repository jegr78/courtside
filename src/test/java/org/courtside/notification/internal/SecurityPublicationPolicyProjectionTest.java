package org.courtside.notification.internal;

import org.courtside.securityassessment.SecurityPublicationPolicyProjection;
import org.courtside.shared.BookingConfirmed;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalApplicationListenerMethodAdapter;
import tools.jackson.databind.json.JsonMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.modulith.events.core.EventPublicationRepository;
import org.springframework.modulith.events.core.EventSerializer;
import org.springframework.modulith.events.core.PublicationTargetIdentifier;
import org.springframework.modulith.events.core.TargetEventPublication;
import org.mockito.ArgumentCaptor;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.HexFormat;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class SecurityPublicationPolicyProjectionTest {
    private static final JsonMapper JSON = JsonMapper.builder().build();

    @Test
    void givenActualBookingMailer_whenPolicyProjected_thenNativeAdapterIdentityIsReturned() throws Exception {
        // given
        var method = BookingMailer.class.getDeclaredMethod("on", BookingConfirmed.class);
        var adapter = new TransactionalApplicationListenerMethodAdapter("bookingMailer", BookingMailer.class, method);
        // when
        var projection = JSON.readTree(SecurityPublicationPolicyProjection.project(new String[0]));
        // then
        assertThat(projection.size()).isEqualTo(4);
        assertThat(projection.get("listenerId").asString()).isEqualTo(adapter.getListenerId());
        assertThat(projection.get("eventType").asString()).isEqualTo(BookingConfirmed.class.getName());
        assertThat(adapter.getTransactionPhase()).isEqualTo(TransactionPhase.BEFORE_COMMIT);
        assertThat(projection.get("repositoryMode").asString()).isEqualTo("JDBC_V2");
        try (var bytes = getClass().getResourceAsStream("/org/springframework/modulith/events/jdbc/JdbcEventPublicationRepositoryV2.class")) {
            assertThat(bytes).isNotNull();
            assertThat(projection.get("repositoryClassDigest").asString()).isEqualTo("sha256:"
                    + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes.readAllBytes())));
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"org.example.UntrustedListener", "--listener", "org.courtside.shared.BookingConfirmed"})
    void givenClassSelectionArgument_whenPolicyProjected_thenArgumentIsRejected(String argument) {
        // given
        var arguments = new String[]{argument};
        // when / then
        assertThatThrownBy(() -> SecurityPublicationPolicyProjection.project(arguments))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("publication-policy-projection-rejected");
    }

    @Test
    void givenMissingArgumentArray_whenPolicyProjected_thenInputIsRejected() {
        // given
        String[] arguments = null;
        // when / then
        assertThatThrownBy(() -> SecurityPublicationPolicyProjection.project(arguments))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("publication-policy-projection-rejected");
    }

    @Test
    void givenNativeDefaultAndExplicitFalse_whenFactorySelectsRepository_thenV2RequiresNoDatabaseCalls() throws Exception {
        // given
        var jdbc = mock(JdbcTemplate.class);
        var serializer = mock(EventSerializer.class);
        // when
        var defaults = repository(null, jdbc, serializer);
        var explicit = repository(false, jdbc, serializer);
        // then
        assertThat(defaults.getClass().getName()).isEqualTo("org.springframework.modulith.events.jdbc.JdbcEventPublicationRepositoryV2");
        assertThat(explicit.getClass()).isEqualTo(defaults.getClass());
        verifyNoInteractions(jdbc, serializer);
    }

    @Test
    void givenNativeLegacyTrue_whenFactorySelectsRepository_thenItCannotBeMistakenForV2() throws Exception {
        // given
        var jdbc = mock(JdbcTemplate.class);
        var serializer = mock(EventSerializer.class);
        // when
        var repository = repository(true, jdbc, serializer);
        // then
        assertThat(repository.getClass().getName()).isEqualTo("org.springframework.modulith.events.jdbc.JdbcEventPublicationRepository");
        verifyNoInteractions(jdbc, serializer);
    }

    @Test
    void givenActualNativePublication_whenV2CreatesProcessesAndCompletes_thenActualSqlCarriesNativeStatusAttemptDateAndDelete() throws Exception {
        // given
        var jdbc = mock(JdbcTemplate.class);
        var serializer = mock(EventSerializer.class);
        var event = new BookingConfirmed(UUID.fromString("30000000-0000-0000-0000-000000000001"));
        var publicationDate = Instant.parse("2026-10-05T10:00:00.123456Z");
        var publication = TargetEventPublication.of(event, PublicationTargetIdentifier.of("example-listener"), publicationDate);
        when(serializer.serialize(event)).thenReturn("{\"bookingId\":\"30000000-0000-0000-0000-000000000001\"}");
        when(jdbc.update(anyString(), any(Object[].class))).thenReturn(1);
        var repository = repository(null, jdbc, serializer);
        // when
        repository.create(publication);
        repository.markProcessing(publication.getIdentifier());
        repository.markCompleted(publication.getIdentifier(), publicationDate.plusSeconds(1));
        // then
        var sql = ArgumentCaptor.forClass(String.class);
        var arguments = ArgumentCaptor.forClass(Object[].class);
        verify(jdbc, times(3)).update(sql.capture(), arguments.capture());
        assertThat(publication.getStatus().name()).isEqualTo("PUBLISHED");
        assertThat(sql.getAllValues().getFirst()).contains("STATUS, COMPLETION_ATTEMPTS, LAST_RESUBMISSION_DATE");
        assertThat(arguments.getAllValues().getFirst()).hasSize(8);
        assertThat(arguments.getAllValues().getFirst()[5]).isEqualTo(publication.getStatus().name());
        assertThat(arguments.getAllValues().getFirst()[6]).isEqualTo(1);
        assertThat(arguments.getAllValues().getFirst()[7]).isEqualTo(Timestamp.from(publicationDate));
        assertThat(sql.getAllValues().get(1)).contains("STATUS = 'PROCESSING'");
        assertThat(sql.getAllValues().get(2)).startsWith("DELETE FROM EVENT_PUBLICATION");
    }

    private EventPublicationRepository repository(Boolean legacy, JdbcTemplate jdbc, EventSerializer serializer) throws Exception {
        var factory = SecurityPublicationPolicyProjection.class.getDeclaredMethod("repository", Boolean.class, JdbcTemplate.class, Object.class);
        factory.setAccessible(true);
        return (EventPublicationRepository) factory.invoke(null, legacy, jdbc, serializer);
    }
}
