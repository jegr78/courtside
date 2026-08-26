package org.courtside.booking;

import org.courtside.booking.internal.CourtAllocationRepository;
import org.junit.jupiter.api.Test;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

class CursorPredicateTest {

    private static final String CURSOR = "cursor";

    private static final Path SOURCES = Path.of("src/main/java");

    private static final List<Class<?>> REPOSITORIES =
            List.of(BookingRepository.class, CourtAllocationRepository.class);

    // A paged query switches on its first page as well as on who is asking, and the switch is not
    // a visibility boundary — naming it here is what keeps this check honest about the difference.
    private static final Set<String> NOT_A_VISIBILITY_BOUNDARY = Set.of("firstPage");

    @Test
    void everyPagedQueryResolvesItsCursorUnderTheConditionsItSelectsRowsUnder() {
        // when
        TreeSet<String> unguarded = new TreeSet<>();
        List<Method> paged = pagedQueries();
        for (Method query : paged) {
            String clause = cursorClauseOf(query);
            for (String parameter : visibilityParametersOf(query)) {
                if (!clause.contains(":" + parameter)) {
                    unguarded.add(query.getName() + " resolves its cursor without :" + parameter);
                }
            }
        }

        // then
        assertThat(paged)
                .as("a check that finds no paged query proves nothing")
                .isNotEmpty();
        assertThat(unguarded)
                .as("resolving a cursor is itself a read of the row it names, so the clause that"
                        + " resolves it carries every parameter the surrounding query is gated by."
                        + " A cursor resolved without one of them answers whether a row the caller"
                        + " may not see exists, and where in the order it sits. A parameter that is"
                        + " genuinely not a visibility boundary belongs in"
                        + " NOT_A_VISIBILITY_BOUNDARY, where the exemption is visible."
                        + " This reads the query text, so it proves the parameter is named in the"
                        + " clause and not that it constrains it — the behaviour tests are what"
                        + " prove that.")
                .isEmpty();
    }

    @Test
    void everyRepositoryThatPagesByCursorIsAmongTheOnesThisChecks() {
        // when
        List<String> declaring = sourcesNaming("@Param(\"" + CURSOR + "\")");

        // then
        assertThat(declaring)
                .as("a repository this check never opens is a cursor nobody guards, so a new one"
                        + " must be added to REPOSITORIES rather than pass unseen")
                .containsExactlyInAnyOrderElementsOf(REPOSITORIES.stream()
                        .map(repository -> repository.getSimpleName() + ".java")
                        .sorted().toList());
    }

    private static List<String> sourcesNaming(String marker) {
        try (Stream<Path> sources = Files.walk(SOURCES)) {
            return sources.filter(path -> path.toString().endsWith(".java"))
                    .filter(path -> readAll(path).contains(marker))
                    .map(path -> path.getFileName().toString())
                    .sorted(Comparator.naturalOrder())
                    .toList();
        } catch (IOException unreadable) {
            throw new UncheckedIOException(unreadable);
        }
    }

    private static String readAll(Path source) {
        try {
            return Files.readString(source);
        } catch (IOException unreadable) {
            throw new UncheckedIOException(unreadable);
        }
    }

    private static List<Method> pagedQueries() {
        return REPOSITORIES.stream()
                .flatMap(repository -> Arrays.stream(repository.getDeclaredMethods()))
                .filter(method -> method.isAnnotationPresent(Query.class))
                .filter(method -> namedParametersOf(method).contains(CURSOR))
                .toList();
    }

    // The clause ends where the ordering begins: a condition sorted below it would otherwise
    // satisfy this check while the cursor stays unguarded.
    private static String cursorClauseOf(Method query) {
        String statement = query.getAnnotation(Query.class).value();
        int opens = statement.indexOf(":" + CURSOR);
        assertThat(opens)
                .as("%s takes a cursor, so its query must name it", query.getName())
                .isNotNegative();
        int orders = statement.lastIndexOf("ORDER BY");
        assertThat(orders)
                .as("%s pages, so its query must state an order", query.getName())
                .isGreaterThan(opens);
        return statement.substring(opens, orders);
    }

    private static List<String> visibilityParametersOf(Method query) {
        return namedParametersOf(query).stream()
                .filter(name -> !CURSOR.equals(name))
                .filter(name -> !NOT_A_VISIBILITY_BOUNDARY.contains(name))
                .toList();
    }

    private static List<String> namedParametersOf(Method query) {
        return Arrays.stream(query.getParameters())
                .map(parameter -> Optional.ofNullable(parameter.getAnnotation(Param.class)))
                .flatMap(Optional::stream)
                .map(Param::value)
                .toList();
    }
}
