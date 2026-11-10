package org.courtside;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.AnnotatedBeanDefinition;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.annotation.MergedAnnotations;
import org.springframework.test.context.BootstrapUtils;
import org.springframework.test.context.BootstrapWith;
import org.springframework.test.context.MergedContextConfiguration;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

class SpringContextConfigurationBoundTest {

    // Each distinct configuration is one more context start; raise this only together with a reason in review.
    private static final int BOUND = 65;

    @Test
    void whenEveryTestClassResolvesItsContextConfiguration_thenTheDistinctConfigurationsStayWithinTheBound() throws Exception {
        // when
        Map<MergedContextConfiguration, TreeSet<String>> classesByConfiguration = new LinkedHashMap<>();
        for (Class<?> testClass : springTestClasses()) {
            MergedContextConfiguration configuration = BootstrapUtils.resolveTestContextBootstrapper(testClass)
                    .buildMergedContextConfiguration();
            classesByConfiguration.computeIfAbsent(configuration, ignored -> new TreeSet<>()).add(testClass.getSimpleName());
        }

        // then
        String rarest = classesByConfiguration.values().stream()
                .sorted(Comparator.comparingInt(TreeSet<String>::size).thenComparing(TreeSet::first))
                .limit(10)
                .map(classes -> String.join(", ", classes))
                .collect(Collectors.joining("\n  ", "\n  ", ""));
        assertThat(classesByConfiguration.size())
                .as("%d test classes resolve to %d distinct Spring context configurations, the bound is %d;"
                        + " fold one of the configurations used by fewest classes into a shared one:%s",
                        classesByConfiguration.values().stream().mapToInt(TreeSet::size).sum(),
                        classesByConfiguration.size(), BOUND, rarest)
                .isLessThanOrEqualTo(BOUND);
    }

    private static List<Class<?>> springTestClasses() throws ClassNotFoundException {
        ClassPathScanningCandidateComponentProvider scanner = new ClassPathScanningCandidateComponentProvider(false) {
            @Override
            protected boolean isCandidateComponent(AnnotatedBeanDefinition definition) {
                return definition.getMetadata().isIndependent() && definition.getMetadata().isConcrete();
            }
        };
        scanner.addIncludeFilter((reader, factory) -> reader.getClassMetadata().getClassName().matches(".*Tests?$"));
        List<Class<?>> classes = new ArrayList<>();
        for (var definition : scanner.findCandidateComponents("org.courtside")) {
            Class<?> candidate = Class.forName(definition.getBeanClassName());
            if (MergedAnnotations.from(candidate, MergedAnnotations.SearchStrategy.TYPE_HIERARCHY).isPresent(BootstrapWith.class)) {
                classes.add(candidate);
            }
        }
        return classes;
    }
}
