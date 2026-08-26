package org.courtside.booking;

import org.junit.jupiter.api.Test;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.TreeSet;

import static org.assertj.core.api.Assertions.assertThat;

class CursorPredicateTest {

    private static final String CURSOR = "cursor";

    private static final String OPENS_THE_CURSOR_CLAUSE = ":cursor IS NULL";

    @Test
    void everyPagedQueryResolvesItsCursorUnderTheSameConditionsItSelectsRowsUnder() {
        // when
        TreeSet<String> unguarded = new TreeSet<>();
        List<Method> paged = pagedQueries();
        for (Method query : paged) {
            for (String parameter : identityParametersOf(query)) {
                if (!cursorClauseOf(query).contains(":" + parameter)) {
                    unguarded.add(query.getName() + " resolves its cursor without :" + parameter);
                }
            }
        }

        // then
        assertThat(paged)
                .as("a check that finds no paged query proves nothing")
                .isNotEmpty();
        assertThat(unguarded)
                .as("resolving a cursor is itself a read of the booking it names, so it carries"
                        + " every parameter the surrounding query is gated by. A cursor resolved"
                        + " without one of them answers whether an id the caller may not see exists,"
                        + " and where in time it sits. If a parameter is genuinely not a visibility"
                        + " boundary, say so by naming it here rather than by leaving the clause"
                        + " open.")
                .isEmpty();
    }

    private static List<Method> pagedQueries() {
        return Arrays.stream(BookingRepository.class.getDeclaredMethods())
                .filter(method -> method.isAnnotationPresent(Query.class))
                .filter(method -> namedParametersOf(method).contains(CURSOR))
                .toList();
    }

    private static String cursorClauseOf(Method query) {
        String statement = query.getAnnotation(Query.class).value();
        int opens = statement.indexOf(OPENS_THE_CURSOR_CLAUSE);
        assertThat(opens)
                .as("%s takes a cursor, so its query must open a clause with %s",
                        query.getName(), OPENS_THE_CURSOR_CLAUSE)
                .isNotNegative();
        return statement.substring(opens);
    }

    private static List<String> identityParametersOf(Method query) {
        return namedParametersOf(query).stream().filter(name -> !CURSOR.equals(name)).toList();
    }

    private static List<String> namedParametersOf(Method query) {
        return Arrays.stream(query.getParameters())
                .map(parameter -> Optional.ofNullable(parameter.getAnnotation(Param.class)))
                .flatMap(Optional::stream)
                .map(Param::value)
                .toList();
    }
}
