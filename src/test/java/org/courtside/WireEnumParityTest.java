package org.courtside;

import org.courtside.api.ApiCancelScope;
import org.courtside.api.ApiDayOfWeek;
import org.courtside.api.ApiMessageKind;
import org.courtside.api.ApiMessageState;
import org.courtside.api.ApiRole;
import org.courtside.api.ApiRuleType;
import org.courtside.booking.series.CancelScope;
import org.courtside.identity.Role;
import org.courtside.notification.MessageKind;
import org.courtside.notification.MessageState;
import org.courtside.rules.RuleType;
import org.junit.jupiter.api.Test;

import java.time.DayOfWeek;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Stream;

import static java.util.stream.Collectors.toSet;

import static org.assertj.core.api.Assertions.assertThat;

// These enums exist twice, in the domain and hand-written in the document.
class WireEnumParityTest {

    @Test
    void whenComparingEveryEnumTheDocumentDeclares_thenItNamesExactlyWhatTheDomainKnows() {
        assertParity("Role", ApiRole.values(), ApiRole::getValue, Role.values());
        assertParity("RuleType", ApiRuleType.values(), ApiRuleType::getValue, RuleType.values());
        assertParity("CancelScope", ApiCancelScope.values(), ApiCancelScope::getValue,
                CancelScope.values());
        assertParity("DayOfWeek", ApiDayOfWeek.values(), ApiDayOfWeek::getValue, DayOfWeek.values());
        assertParity("MessageState", ApiMessageState.values(), ApiMessageState::getValue,
                MessageState.values());
        assertParity("MessageKind", ApiMessageKind.values(), ApiMessageKind::getValue,
                MessageKind.values());
    }

    private static <T> void assertParity(
            String name, T[] documented, Function<T, String> wireValue, Enum<?>[] domain) {
        Set<String> onTheWire = Stream.of(documented).map(wireValue).collect(toSet());
        Set<String> inTheDomain = Stream.of(domain).map(Enum::name).collect(toSet());

        assertThat(onTheWire)
                .as("%s in the API document must name exactly the constants the domain has:"
                        + " a value only the document knows is a 500 waiting to happen, and one"
                        + " only the domain knows cannot be reached through the API at all", name)
                .isEqualTo(inTheDomain);
    }
}
