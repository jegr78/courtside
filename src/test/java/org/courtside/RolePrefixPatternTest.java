package org.courtside;

import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;

import static org.assertj.core.api.Assertions.assertThat;

class RolePrefixPatternTest {

    @Test
    void whenReadingBothRolePrefixConstants_thenTheyAgree() throws ReflectiveOperationException {
        // given
        String grantedPrefix = rolePrefixOf("org.courtside.identity.internal.CourtsideUserDetailsService");

        // when
        String strippedPrefix = rolePrefixOf("org.courtside.card.web.CardController");

        // then
        assertThat(strippedPrefix)
                .as("CardController.ROLE_PREFIX has drifted from the prefix "
                        + "CourtsideUserDetailsService grants authorities with; the card module "
                        + "cannot depend on identity, so this prefix is hand-duplicated and must "
                        + "match '%s'", grantedPrefix)
                .isEqualTo(grantedPrefix);
    }

    private static String rolePrefixOf(String className) throws ReflectiveOperationException {
        Field field = Class.forName(className).getDeclaredField("ROLE_PREFIX");
        field.setAccessible(true);
        return (String) field.get(null);
    }
}
