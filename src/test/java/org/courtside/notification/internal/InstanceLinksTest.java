package org.courtside.notification.internal;

import org.courtside.notification.MessageKind;
import org.junit.jupiter.api.Test;

import java.util.EnumMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class InstanceLinksTest {

    private static final UUID BOOKING = UUID.fromString("11111111-2222-3333-4444-555555555555");
    private static final UUID ENTRY = UUID.fromString("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    private static final String ADDRESS = "https://courts.example.org";
    static final Set<MessageKind> CREDENTIAL_KINDS = Set.of(MessageKind.CREDENTIALS_NEW_ACCOUNT,
            MessageKind.CREDENTIALS_PASSWORD_RESET, MessageKind.ACCOUNT_PASSWORD_RESET_CODE,
            MessageKind.ACCOUNT_USERNAME_REMINDER);
    static final Set<MessageKind> LINKED = Stream.of(MessageKind.values())
            .filter(kind -> !CREDENTIAL_KINDS.contains(kind)).collect(Collectors.toSet());

    @Test
    void givenAnAddressThatIsNotTheBareHttpsOriginOfAnInstance_whenStarting_thenTheInstanceRefusesToStart() {
        // given
        for (String notAnOrigin : new String[] {
                "http://courts.example.org", "courts.example.org", "//courts.example.org",
                "https:courts.example.org", "javascript:alert(1)", "ftp://courts.example.org",
                "https://courts.example.org/club", "https://courts.example.org/my-bookings/",
                "https://courts.example.org?club=1", "https://courts.example.org/?club=1",
                "https://courts.example.org#top", "https://", "https:///", "https://courts example.org",
                "https://user:secret@courts.example.org"}) {

            // when / then
            assertThatThrownBy(() -> new InstanceLinks(notAnOrigin))
                    .as("%s", notAnOrigin)
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("COURTSIDE_PUBLIC_URL");
        }
    }

    @Test
    void givenCredentialsInTheAddress_whenStarting_thenTheFailureDoesNotDiscloseThem() {
        // when / then
        assertThatThrownBy(() -> new InstanceLinks("https://user:secret@courts.example.org"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("COURTSIDE_PUBLIC_URL")
                .hasMessageNotContaining("user:")
                .hasMessageNotContaining("secret");
    }

    @Test
    void givenTheHttpsOriginOfAnInstance_whenStarting_thenItIsAcceptedWithOrWithoutAPortOrRootSlash() {
        // when / then
        for (String origin : new String[] {ADDRESS, ADDRESS + "/", "HTTPS://courts.example.org",
                "https://courts.example.org:8443", "https://[2001:db8::1]"}) {
            assertThatCode(() -> new InstanceLinks(origin)).as("%s", origin).doesNotThrowAnyException();
        }
    }

    @Test
    void givenNoAddress_whenAnyBookingMessageAsksForItsLink_thenItIsEmpty() {
        // given
        for (String unset : new String[] {null, "", "   "}) {
            InstanceLinks links = new InstanceLinks(unset);

            // when / then
            for (MessageKind kind : LINKED) {
                assertThat(links.of(message(kind))).as("%s with %s", kind, unset).isEmpty();
            }
        }
    }

    @Test
    void givenAnAddress_whenEachBookingMessageAsksForItsLink_thenItLeadsWhereTheMemberActsOnIt() {
        // given
        InstanceLinks links = new InstanceLinks(ADDRESS + "/");
        Map<MessageKind, String> expected = new EnumMap<>(MessageKind.class);
        String booking = ADDRESS + "/my-bookings#booking-" + BOOKING;
        String bookings = ADDRESS + "/my-bookings";
        expected.put(MessageKind.BOOKING_CONFIRMED, booking);
        expected.put(MessageKind.BOOKING_PLAYER_RECORDED, booking);
        expected.put(MessageKind.BOOKING_PLAYER_WITHDREW, booking);
        expected.put(MessageKind.BOOKING_DISPLACED, booking);
        expected.put(MessageKind.BOOKING_REMINDER, booking);
        expected.put(MessageKind.BOOKING_CANCELLED, bookings);
        expected.put(MessageKind.BOOKING_CANCELLED_BY_CLUB, bookings);
        expected.put(MessageKind.BOOKING_SERIES_CREATED, bookings);
        expected.put(MessageKind.BOOKING_SERIES_CANCELLED_BY_CLUB, bookings);
        expected.put(MessageKind.BOOKING_SERIES_MOVED_BY_CLUB, bookings);
        expected.put(MessageKind.WAITLIST_OFFER, ADDRESS + "/my-bookings#waitlist-" + ENTRY);

        // when
        Map<MessageKind, String> resolved = new EnumMap<>(MessageKind.class);
        LINKED.forEach(kind -> resolved.put(kind, links.of(message(kind))));

        // then
        assertThat(resolved).as("every linked kind and its target").isEqualTo(expected);
    }

    @Test
    void givenACredentialMessage_whenItAsksForALink_thenThereIsNone() {
        // given
        InstanceLinks links = new InstanceLinks(ADDRESS);

        // when / then
        for (MessageKind kind : CREDENTIAL_KINDS) {
            assertThatThrownBy(() -> links.of(message(kind))).as("%s", kind)
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining(kind.name());
        }
    }

    private static QueuedMessage message(MessageKind kind) {
        return new QueuedMessage(UUID.randomUUID(), kind, Map.of(
                QueuedMessage.BOOKING, BOOKING.toString(),
                QueuedMessage.WAITLIST_ENTRY, ENTRY.toString()));
    }
}
