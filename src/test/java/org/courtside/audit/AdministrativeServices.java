package org.courtside.audit;

import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.annotation.AnnotationUtils;
import org.springframework.core.type.filter.AnnotationTypeFilter;
import org.springframework.stereotype.Service;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Deque;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;

// A service is administrative because the admin API reaches it, not because somebody listed it, so
// a new one is covered on the day its controller is written.
final class AdministrativeServices {

    private static final String ROOT = "org.courtside";
    private static final String ADMIN_PATH = "/api/admin";
    private static final String GENERATED_API = "org.courtside.api.";

    private AdministrativeServices() {
    }

    static List<Class<?>> derived() {
        Set<Class<?>> found = new TreeSet<>(Comparator.comparing(Class::getName));
        Deque<Class<?>> pending = new ArrayDeque<>();
        administrativeControllers().forEach(controller -> pending.addAll(servicesInjectedInto(controller)));
        while (!pending.isEmpty()) {
            Class<?> service = pending.poll();
            if (found.add(service)) {
                pending.addAll(servicesInjectedInto(service));
            }
        }
        return List.copyOf(found);
    }

    private static List<Class<?>> administrativeControllers() {
        ClassPathScanningCandidateComponentProvider scanner =
                new ClassPathScanningCandidateComponentProvider(false);
        scanner.addIncludeFilter(new AnnotationTypeFilter(RestController.class));
        List<Class<?>> controllers = new ArrayList<>();
        for (BeanDefinition candidate : scanner.findCandidateComponents(ROOT)) {
            Class<?> controller = load(candidate.getBeanClassName());
            if (servesTheAdminApi(controller)) {
                controllers.add(controller);
            }
        }
        return controllers;
    }

    // Controllers carry no mapping annotations of their own, so the path lives on the generated
    // interface they implement.
    private static boolean servesTheAdminApi(Class<?> controller) {
        for (Class<?> api : controller.getInterfaces()) {
            if (!api.getName().startsWith(GENERATED_API)) {
                continue;
            }
            for (Method operation : api.getMethods()) {
                RequestMapping mapping = AnnotationUtils.findAnnotation(operation, RequestMapping.class);
                if (mapping != null && List.of(mapping.value()).stream().anyMatch(AdministrativeServices::isAdmin)) {
                    return true;
                }
            }
        }
        return false;
    }

    private static boolean isAdmin(String path) {
        return path.equals(ADMIN_PATH) || path.startsWith(ADMIN_PATH + "/");
    }

    private static List<Class<?>> servicesInjectedInto(Class<?> type) {
        List<Class<?>> services = new ArrayList<>();
        for (Constructor<?> constructor : type.getDeclaredConstructors()) {
            for (Class<?> parameter : constructor.getParameterTypes()) {
                if (parameter.getName().startsWith(ROOT)
                        && AnnotationUtils.findAnnotation(parameter, Service.class) != null) {
                    services.add(parameter);
                }
            }
        }
        return services;
    }

    private static Class<?> load(String name) {
        try {
            return Class.forName(name);
        } catch (ClassNotFoundException e) {
            throw new IllegalStateException("Cannot load " + name, e);
        }
    }
}
