package org.courtside;

import org.junit.jupiter.api.Test;
import org.springframework.modulith.core.ApplicationModules;

class ModularityTests {

    private final ApplicationModules modules = ApplicationModules.of(CourtsideApplication.class);

    @Test
    void whenModulesAreVerified_thenNoBoundaryIsViolated() {
        // when / then
        modules.verify();
    }
}
