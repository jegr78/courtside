package org.courtside;

import org.courtside.api.ApiCancelScope;
import org.courtside.api.ApiDayOfWeek;
import org.courtside.api.ApiMatchType;
import org.courtside.api.ApiRole;
import org.courtside.api.ApiRuleType;
import org.courtside.booking.internal.MatchType;
import org.courtside.booking.series.CancelScope;
import org.courtside.identity.Role;
import org.courtside.rules.internal.RuleType;
import org.junit.jupiter.api.Test;

import java.time.DayOfWeek;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Stream;

import static java.util.stream.Collectors.toSet;

import static org.assertj.core.api.Assertions.assertThat;

// Five enums now exist twice: once in the domain and once, written by hand, in the API document.
// Nothing makes the two agree — the generator reads only the document, and the compiler never sees
// them side by side. The controllers cross between them by name.
//
// Both directions of drift fail closed rather than open, but neither fails well. A value only the
// domain knows simply cannot be set through the API, silently. A value only the document knows
// deserialises and then throws on the way into the domain — a 500 for a request the document said
// was valid.
//
// The same shape as HexColorPatternTest, for the same reason: two copies of one fact, and a test
// as the only thing holding them together.
class WireEnumParityTest {

    @Test
    void whenComparingEveryEnumTheDocumentDeclares_thenItNamesExactlyWhatTheDomainKnows() {
        assertParity("Role", ApiRole.values(), ApiRole::getValue, Role.values());
        assertParity("RuleType", ApiRuleType.values(), ApiRuleType::getValue, RuleType.values());
        assertParity("CancelScope", ApiCancelScope.values(), ApiCancelScope::getValue,
                CancelScope.values());
        assertParity("MatchType", ApiMatchType.values(), ApiMatchType::getValue, MatchType.values());
        assertParity("DayOfWeek", ApiDayOfWeek.values(), ApiDayOfWeek::getValue, DayOfWeek.values());
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
