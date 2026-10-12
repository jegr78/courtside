package org.courtside.notification.internal;

import org.courtside.notification.MessageKind;
import org.junit.jupiter.api.Test;

import java.util.EnumMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class InstanceLinksTest {

    private static final UUID BOOKING = UUID.fromString("11111111-2222-3333-4444-555555555555");
    private static final UUID ENTRY = UUID.fromString("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    private static final String ADDRESS = "https://courts.example.org";

    @Test
    void givenAnAddressThatIsNotTheBareHttpsOriginOfAnInstance_whenStarting_thenTheInstanceRefusesToStart() {
        // given
        for (String notAnOrigin : new String[] {
                "http://courts.example.org", "courts.example.org", "//courts.example.org",
                "https:courts.example.org", "javascript:alert(1)", "ftp://courts.example.org",
                "https://courts.example.org/club", "https://courts.example.org/my-bookings/",
                "https://courts.example.org?club=1", "https://courts.example.org/?club=1",
                "https://courts.example.org#top", "https://", "https:///", "https://courts example.org",
                "https://courts.example.org:", "https://courts.example.org:0", "https://courts.example.org:99999",
                "https://under_score.example.org", "https://courts.example.org%2F",
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
    void givenAnAddressWithAPort_whenALinkIsBuilt_thenThePortStaysInTheOrigin() {
        // given
        InstanceLinks links = new InstanceLinks("https://courts.example.org:65535");

        // when / then
        assertThat(links.of(message(MessageKind.BOOKING_CANCELLED)))
                .isEqualTo("https://courts.example.org:65535/my-bookings");
    }

    @Test
    void givenAnInternationalisedDomain_whenALinkIsBuilt_thenItCarriesTheAsciiFormOfTheHost() {
        // given
        InstanceLinks links = new InstanceLinks("https://bücher.example.org");

        // when / then
        assertThat(links.of(message(MessageKind.BOOKING_CANCELLED)))
                .as("a mail client links only what it recognises, and Punycode is what every client recognises")
                .isEqualTo("https://xn--bcher-kva.example.org/my-bookings");
    }

    @Test
    void givenNoAddress_whenAnyBookingMessageAsksForItsLink_thenItIsEmpty() {
        // given
        for (String unset : new String[] {null, "", "   "}) {
            InstanceLinks links = new InstanceLinks(unset);

            // when / then
            for (MessageKind kind : ShippedMessageKinds.LINKED) {
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
        ShippedMessageKinds.LINKED.forEach(kind -> resolved.put(kind, links.of(message(kind))));

        // then
        assertThat(resolved).as("every linked kind and its target").isEqualTo(expected);
    }

    @Test
    void givenACredentialMessage_whenItAsksForALink_thenThereIsNone() {
        // given
        InstanceLinks links = new InstanceLinks(ADDRESS);

        // when / then
        for (MessageKind kind : ShippedMessageKinds.CREDENTIAL) {
            assertThatThrownBy(() -> links.of(message(kind))).as("%s", kind)
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining(kind.name());
        }
    }

    private static QueuedMessage message(MessageKind kind) {
        Map<String, String> parameters = switch (kind) {
            case BOOKING_SERIES_CREATED, BOOKING_SERIES_CANCELLED_BY_CLUB, BOOKING_SERIES_MOVED_BY_CLUB ->
                    Map.of(QueuedMessage.SERIES, UUID.randomUUID().toString());
            case WAITLIST_OFFER -> Map.of(QueuedMessage.WAITLIST_ENTRY, ENTRY.toString());
            default -> Map.of(QueuedMessage.BOOKING, BOOKING.toString());
        };
        return new QueuedMessage(UUID.randomUUID(), kind, parameters);
    }
}
