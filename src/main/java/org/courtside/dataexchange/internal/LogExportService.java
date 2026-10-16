package org.courtside.dataexchange.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.audit.AuditLogExport;
import org.courtside.config.ClubTimeZone;
import org.courtside.dataexchange.DataExchangeEvent;
import org.courtside.dataexchange.ExportPeriodInvalidException;
import org.courtside.dataexchange.SupportedEncodings;
import org.courtside.notification.MessageLogExport;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.InputStream;
import java.nio.charset.Charset;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.function.Function;
import java.util.function.Supplier;

@Service
@RequiredArgsConstructor
public class LogExportService {

    static final int BATCH = 500;

    private static final List<String> AUDIT_HEADER = List.of("occurredAt", "eventType", "subjectId",
            "subjectName", "actorAccountId", "actorUsername", "parameters");
    private static final List<String> MESSAGE_HEADER = List.of("queuedAt", "settledAt", "kind", "state",
            "messageId", "personId", "personName", "reason", "statusCode");
    private static final DateTimeFormatter INSTANT = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssXXX");

    private final AuditLogExport auditLog;
    private final MessageLogExport messageLog;
    private final ClubTimeZone clubTimeZone;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    @Transactional
    public InputStream auditLog(LocalDate from, LocalDate to, char separator, String encoding) {
        Window window = opened(from, to, separator, DataExchangeEvent.LogExported.AUDIT);
        ZoneId zone = clubTimeZone.zoneId();
        return new StreamedCsv(AUDIT_HEADER, batches(
                after -> auditLog.changes(window.from(), window.before(), after, BATCH),
                AuditLogExport.ExportedChange::id,
                change -> cells(formatted(change.occurredAt(), zone), change.eventType(), text(change.subjectId()),
                        change.subjectName(), text(change.actorAccountId()), change.actorUsername(),
                        change.parameters())),
                separator, charset(encoding));
    }

    @Transactional
    public InputStream messageLog(LocalDate from, LocalDate to, char separator, String encoding) {
        Window window = opened(from, to, separator, DataExchangeEvent.LogExported.MESSAGES);
        ZoneId zone = clubTimeZone.zoneId();
        return new StreamedCsv(MESSAGE_HEADER, batches(
                after -> messageLog.messages(window.from(), window.before(), after, BATCH),
                MessageLogExport.ExportedMessage::id,
                message -> cells(formatted(message.queuedAt(), zone), formatted(message.settledAt(), zone),
                        message.kind().name(), message.state().name(), message.messageId(),
                        text(message.personId()), message.personName(), message.reason(), message.statusCode())),
                separator, charset(encoding));
    }

    // The file ends with what was recorded before the request, so the entry recording this export
    // is never part of it and a log that keeps growing still gives one finite file.
    private Window opened(LocalDate from, LocalDate to, char separator, String log) {
        RosterExportService.requireUsableSeparator(separator);
        if (from != null && to != null && to.isBefore(from)) {
            throw new ExportPeriodInvalidException(from, to);
        }
        ZoneId zone = clubTimeZone.zoneId();
        Instant now = clock.instant();
        Instant end = to == null ? now : to.plusDays(1).atStartOfDay(zone).toInstant();
        Window window = new Window(from == null ? null : from.atStartOfDay(zone).toInstant(),
                end.isBefore(now) ? end : now);
        events.publishEvent(new DataExchangeEvent.LogExported(log, from, to));
        return window;
    }

    private static Charset charset(String encoding) {
        return SupportedEncodings.forWriting(encoding);
    }

    private static <T> Supplier<List<List<String>>> batches(
            Function<UUID, List<T>> read, Function<T, UUID> idOf, Function<T, List<String>> cellsOf) {
        UUID[] last = {null};
        return () -> {
            List<T> batch = read.apply(last[0]);
            if (!batch.isEmpty()) {
                last[0] = idOf.apply(batch.getLast());
            }
            return batch.stream().map(cellsOf).toList();
        };
    }

    private static List<String> cells(String... values) {
        return Arrays.asList(values);
    }

    private static String formatted(Instant instant, ZoneId zone) {
        return instant == null ? null : INSTANT.format(instant.atZone(zone));
    }

    private static String text(UUID id) {
        return id == null ? null : id.toString();
    }

    private record Window(Instant from, Instant before) {
    }
}
