package org.courtside;

import org.courtside.identity.Role;
import jakarta.validation.constraints.Pattern;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.util.Arrays;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

class RequiredRolePatternTest {

    @Test
    void whenReadingTheBookingCardRequiredRolePattern_thenItAcceptsExactlyTheRoleEnumConstants()
            throws ReflectiveOperationException {
        // given
        String expected = "^(" + Arrays.stream(Role.values())
                .map(Enum::name)
                .collect(Collectors.joining("|")) + ")$";

        // when
        Field requiredRole = Class
                .forName("org.courtside.card.web.CardAdminWebModels$BookingCardRequest")
                .getDeclaredField("requiredRole");
        String actual = requiredRole.getAnnotation(Pattern.class).regexp();

        // then
        assertThat(actual)
                .as("CardAdminWebModels.BookingCardRequest.requiredRole's @Pattern regexp has "
                        + "drifted from org.courtside.identity.Role; the card module cannot depend "
                        + "on identity, so this pattern is hand-written and must be updated to '%s'",
                        expected)
                .isEqualTo(expected);
    }
}
