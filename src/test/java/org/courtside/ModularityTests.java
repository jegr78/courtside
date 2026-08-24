package org.courtside;

import org.junit.jupiter.api.Test;
import org.springframework.modulith.core.ApplicationModule;
import org.springframework.modulith.core.ApplicationModules;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class ModularityTests {

    private final ApplicationModules modules = ApplicationModules.of(CourtsideApplication.class);

    @Test
    void whenModulesAreVerified_thenNoBoundaryIsViolated() {
        // when / then
        modules.verify();
    }

    // The message log reads accounts to name who was written to. The module that raises the event
    // must stay ignorant of it, and `verify()` only holds that while identity does not declare it.
    @Test
    void givenTheMessageLogReadsIdentity_whenTheDeclarationsAreRead_thenIdentityDoesNotDeclareIt() {
        // when
        ApplicationModule identity = declaring("identity");
        ApplicationModule notification = declaring("notification");

        // then
        assertThat(allowedDependenciesOf(identity))
                .as("a log of who was written to must not be reachable from the module that writes them")
                .doesNotContain("notification");
        assertThat(allowedDependenciesOf(notification)).contains("identity");
    }

    private ApplicationModule declaring(String name) {
        return modules.getModuleByName(name).orElseThrow();
    }

    private static List<String> allowedDependenciesOf(ApplicationModule module) {
        return List.of(module.getBasePackage().getAnnotation(
                org.springframework.modulith.ApplicationModule.class).orElseThrow().allowedDependencies());
    }
}
