package org.courtside.booking.internal;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.core.spi.FilterReply;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.assertThat;

class TranslatedOverlapLogFilterTest {

    private final LoggerContext context = new LoggerContext();
    private final TranslatedOverlapLogFilter filter = new TranslatedOverlapLogFilter();

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "org.hibernate.orm.jdbc.error | WARN | HHH000247: ErrorCode: 0, SQLState: 23P01 | DENY",
            "org.hibernate.orm.jdbc.error | WARN | ERROR: conflicting key value violates exclusion constraint \"court_allocation_no_overlap\" | DENY",
            "org.hibernate.orm.jdbc.error | WARN | HHH000247: ErrorCode: 0, SQLState: 23505 | NEUTRAL",
            "org.hibernate.orm.jdbc.error | WARN | ERROR: duplicate key value violates unique constraint \"person_email\" | NEUTRAL",
            "org.hibernate.orm.jdbc.error | ERROR | HHH000247: ErrorCode: 0, SQLState: 23P01 | NEUTRAL",
            "org.courtside.booking | WARN | HHH000247: ErrorCode: 0, SQLState: 23P01 | NEUTRAL"
    })
    void givenALogLine_whenDecided_thenOnlyTheTranslatedOverlapIsDropped(
            String loggerName, String level, String message, FilterReply expected) {
        // given
        Logger logger = context.getLogger(loggerName);

        // when
        FilterReply reply = filter.decide(null, logger, Level.toLevel(level), message, null, null);

        // then
        assertThat(reply).as("every other database failure still reaches the log").isEqualTo(expected);
    }
}
