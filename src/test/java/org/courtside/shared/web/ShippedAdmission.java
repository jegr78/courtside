package org.courtside.shared.web;

import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.core.io.ClassPathResource;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.HashMap;
import java.util.Map;

final class ShippedAdmission {

    private ShippedAdmission() {
    }

    static AdmissionProperties defaults() {
        StandardEnvironment environment = new StandardEnvironment();
        try {
            new YamlPropertySourceLoader().load("application", new ClassPathResource("application.yaml"))
                    .forEach(environment.getPropertySources()::addLast);
        } catch (IOException failure) {
            throw new UncheckedIOException(failure);
        }
        return Binder.get(environment).bind("courtside.admission", AdmissionProperties.class).get();
    }

    static AdmissionProperties withAccountBurst(AdmissionProperties properties, int burst) {
        return new AdmissionProperties(new AdmissionProperties.Limit(burst, properties.account().perSecond()),
                properties.address(), properties.trackedPrincipals(), properties.classes());
    }

    static AdmissionProperties withClass(AdmissionProperties properties, String demandClass,
                                         AdmissionProperties.DemandClass decision) {
        Map<String, AdmissionProperties.DemandClass> classes = new HashMap<>(properties.classes());
        if (decision == null) {
            classes.remove(demandClass);
        } else {
            classes.put(demandClass, decision);
        }
        return new AdmissionProperties(properties.account(), properties.address(), properties.trackedPrincipals(),
                classes);
    }
}
