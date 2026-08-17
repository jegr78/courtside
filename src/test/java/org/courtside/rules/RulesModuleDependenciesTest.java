package org.courtside.rules;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.modulith.ApplicationModule;

class RulesModuleDependenciesTest {

    @Test
    void whenRulesDependenciesAreDeclared_thenOnlyUsedModulesAreAllowed() {
        // given
        ApplicationModule module = RulesModuleDependenciesTest.class.getPackage().getAnnotation(ApplicationModule.class);

        // when
        String[] allowedDependencies = module.allowedDependencies();

        // then
        assertThat(allowedDependencies).containsExactlyInAnyOrder("facility", "config");
    }
}
