package org.courtside.booking;

import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.GenericApplicationContext;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class BookingRequestFingerprintTest {

    @Test
    void givenTheApplicationMapper_whenSingletonsInitialize_thenFingerprintSerializationIsPrepared() {
        // given
        ObjectMapper mapper = spy(JsonMapper.builder().build());
        try (var context = new GenericApplicationContext()) {
            context.registerBean(BookingRequestFingerprint.class, () -> new BookingRequestFingerprint(mapper));

            // when
            context.refresh();

            // then
            verify(mapper).writeValueAsBytes(any());
        }
    }

    @Test
    void givenBrokenFingerprintMapping_whenPreparing_thenStartupFails() {
        // given
        ObjectMapper mapper = mock(ObjectMapper.class);
        when(mapper.writeValueAsBytes(any())).thenThrow(new IllegalStateException("Broken fingerprint mapping"));
        try (var context = new GenericApplicationContext()) {
            context.registerBean(BookingRequestFingerprint.class, () -> new BookingRequestFingerprint(mapper));

            // when / then
            assertThatThrownBy(context::refresh).hasMessageContaining("Broken fingerprint mapping");
            assertThat(context.isActive()).isFalse();
        }
    }

    @Test
    void givenEquivalentCourtsAndDifferentParticipants_whenFingerprintingBeforeAndAfterPreparation_thenIdentitySemanticsAreUnchanged() {
        // given
        var fingerprint = new BookingRequestFingerprint(JsonMapper.builder().build());
        UUID first = new UUID(0, 1);
        UUID second = new UUID(0, 2);
        var original = command(List.of(first, second), "Example Guest");
        var reordered = command(List.of(second, first), "Example Guest");
        var changed = command(List.of(first, second), "Other Guest");
        String before = fingerprint.of(original);

        // when
        fingerprint.afterSingletonsInstantiated();

        // then
        assertThat(fingerprint.of(original)).isEqualTo(before).matches("[0-9a-f]{64}");
        assertThat(fingerprint.of(reordered)).isEqualTo(before);
        assertThat(fingerprint.of(changed)).isNotEqualTo(before);
    }

    private static CreateBookingCommand command(List<UUID> courts, String guest) {
        return new CreateBookingCommand(courts, new UUID(0, 3),
                new TimeSlot(Instant.EPOCH, Instant.EPOCH.plusSeconds(3600)),
                new UUID(0, 4), null, Set.of(), null, List.of(ParticipantSpec.guest(guest)), null);
    }
}
