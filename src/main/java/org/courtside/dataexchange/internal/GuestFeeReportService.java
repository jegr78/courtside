package org.courtside.dataexchange.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.booking.BookingLedger;
import org.courtside.config.ClubTimeZone;
import org.courtside.dataexchange.DataExchangeEvent;
import org.courtside.dataexchange.SupportedEncodings;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.shared.DatabaseDeadlines;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
import java.time.Year;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Currency;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class GuestFeeReportService {

    private static final List<String> TRAILING_HEADER =
            List.of("firstName", "lastName", "email", "guestPlaces", "amount", "currency");

    private final BookingLedger ledger;
    private final PersonRepository persons;
    private final ExternalReferenceRepository references;
    private final ImportSourceRepository sources;
    private final ClubTimeZone clubTimeZone;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    public record Source(UUID id, String displayName) {
    }

    public record Reference(UUID sourceId, String externalId) {
    }

    public record Row(UUID personId, String firstName, String lastName, String email, List<Reference> references,
                      String currency, int guestPlaces, long sumMinor) {
    }

    public record Report(LocalDate from, LocalDate to, List<Source> sources, List<Row> rows,
                         int unassignedGuestPlaces) {
    }

    public record Download(LocalDate from, LocalDate to, byte[] content) {
    }

    @Transactional(timeoutString = DatabaseDeadlines.REPORT)
    public Report report(LocalDate from, LocalDate to) {
        return read(from, to, DataExchangeEvent.GuestFeesRead.Form.SCREEN);
    }

    @Transactional(timeoutString = DatabaseDeadlines.REPORT)
    public Download file(LocalDate from, LocalDate to, char separator, String encoding) {
        RosterExportService.requireUsableSeparator(separator);
        Report report = read(from, to, DataExchangeEvent.GuestFeesRead.Form.FILE);
        List<String> header = new ArrayList<>();
        report.sources().forEach(source -> header.add(ExportCsv.cell("memberNumber " + source.displayName())));
        header.addAll(TRAILING_HEADER);
        List<List<String>> rows = report.rows().stream().map(row -> cells(row, report.sources())).toList();
        return new Download(report.from(), report.to(),
                ExportCsv.write(header, rows, separator, SupportedEncodings.forWriting(encoding)));
    }

    private Report read(LocalDate requestedFrom, LocalDate requestedTo, DataExchangeEvent.GuestFeesRead.Form form) {
        Year year = Year.now(clock.withZone(clubTimeZone.zoneId()));
        LocalDate from = requestedFrom == null ? year.atDay(1) : requestedFrom;
        LocalDate to = requestedTo == null ? year.atMonth(12).atEndOfMonth() : requestedTo;
        BookingLedger.GuestFeeLedger charged = ledger.chargedGuestsBetween(from, to);
        Set<UUID> personIds = charged.members().stream().map(BookingLedger.ChargedGuests::personId)
                .collect(Collectors.toSet());
        Map<UUID, Person> people = persons.findAllById(personIds).stream()
                .collect(Collectors.toMap(Person::getId, Function.identity()));
        Map<UUID, List<Reference>> numbers = references.findByPersonIdIn(personIds).stream()
                .collect(Collectors.groupingBy(ExternalReference::getPersonId,
                        Collectors.mapping(reference -> new Reference(reference.getSourceId(),
                                reference.getExternalId()), Collectors.toCollection(ArrayList::new))));
        List<Source> known = sources.findAllByOrderBySourceKeyAsc().stream()
                .map(source -> new Source(source.getId(), source.getDisplayName())).toList();
        List<UUID> sourceOrder = known.stream().map(Source::id).toList();
        numbers.values().forEach(listed -> listed.sort(Comparator.comparingInt(
                reference -> sourceOrder.indexOf(reference.sourceId()))));
        List<Row> rows = charged.members().stream()
                .map(line -> row(line, people.get(line.personId()), numbers.getOrDefault(line.personId(), List.of())))
                .sorted(Comparator.comparing(Row::lastName).thenComparing(Row::firstName)
                        .thenComparing(Row::personId).thenComparing(Row::currency))
                .toList();
        events.publishEvent(new DataExchangeEvent.GuestFeesRead(from, to, form));
        return new Report(from, to, known, rows, charged.unassignedGuestPlaces());
    }

    private static Row row(BookingLedger.ChargedGuests line, Person person, List<Reference> references) {
        if (person == null) {
            throw new IllegalStateException("A charged booking names an account without a person");
        }
        return new Row(person.getId(), person.getFirstName(), person.getLastName(), person.getEmail(), references,
                line.currency(), line.guestPlaces(), line.sumMinor());
    }

    private static List<String> cells(Row row, List<Source> sources) {
        List<String> cells = new ArrayList<>();
        for (Source source : sources) {
            cells.add(row.references().stream().filter(reference -> reference.sourceId().equals(source.id()))
                    .map(Reference::externalId).findFirst().orElse(""));
        }
        cells.addAll(List.of(row.firstName(), row.lastName(), row.email(), String.valueOf(row.guestPlaces()),
                amount(row.sumMinor(), row.currency()), row.currency()));
        return cells;
    }

    private static String amount(long sumMinor, String currency) {
        return BigDecimal.valueOf(sumMinor, Currency.getInstance(currency).getDefaultFractionDigits()).toPlainString();
    }
}
