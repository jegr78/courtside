package org.courtside.booking.internal;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.turbo.TurboFilter;
import ch.qos.logback.core.spi.FilterReply;
import org.courtside.shared.SqlConstraintViolation;
import org.slf4j.ILoggerFactory;
import org.slf4j.LoggerFactory;
import org.slf4j.Marker;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.stereotype.Component;

// Hibernate warns about every SQL failure, including the overlap the booking module answers with a 409.
@Component
class TranslatedOverlapLogFilter extends TurboFilter implements InitializingBean, DisposableBean {

    static final String JDBC_ERROR_LOGGER = "org.hibernate.orm.jdbc.error";

    @Override
    public FilterReply decide(Marker marker, Logger logger, Level level, String format, Object[] params, Throwable t) {
        if (logger == null || format == null || !JDBC_ERROR_LOGGER.equals(logger.getName()) || !Level.WARN.equals(level)) {
            return FilterReply.NEUTRAL;
        }
        boolean overlapState = format.endsWith("SQLState: " + SqlConstraintViolation.EXCLUSION_VIOLATION);
        boolean overlapMessage = format.contains("violates exclusion constraint \"court_allocation_no_overlap\"");
        return overlapState || overlapMessage ? FilterReply.DENY : FilterReply.NEUTRAL;
    }

    @Override
    public void afterPropertiesSet() {
        if (loggerContext() instanceof LoggerContext context) {
            setContext(context);
            start();
            context.addTurboFilter(this);
        }
    }

    @Override
    public void destroy() {
        if (loggerContext() instanceof LoggerContext context) {
            context.getTurboFilterList().remove(this);
        }
        stop();
    }

    private static ILoggerFactory loggerContext() {
        return LoggerFactory.getILoggerFactory();
    }
}
