package org.courtside.access.internal;

import org.springframework.context.ApplicationContext;

public final class AccessPasses {

    private AccessPasses() {
    }

    public static void runNow(ApplicationContext context) {
        context.getBean(AccessPass.class).runPassNow();
    }
}
