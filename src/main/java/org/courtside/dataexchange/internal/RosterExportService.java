package org.courtside.dataexchange.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.dataexchange.ImportSourceService;
import org.courtside.dataexchange.SupportedEncodings;
import org.courtside.member.MemberService;
import org.courtside.member.RosterService;
import org.courtside.shared.CursorPage;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class RosterExportService {

    static final int PAGE_SIZE = 200;

    private final RosterService roster;
    private final MemberService memberships;
    private final ImportSourceService sources;
    private final ExternalReferenceRepository references;

    public byte[] roster(String query, UUID membershipTypeId, UUID sourceId, char separator,
                         String encoding) {
        Charset charset = SupportedEncodings.resolve(encoding);
        Map<UUID, String> memberNumbers = memberNumbersOf(sourceId);
        return RosterCsv.write(rowsOf(query, membershipTypeId, memberNumbers, new HashMap<>()),
                separator, charset);
    }

    // Read page by page through the same operation the administrative list reads, so the file and
    // the screen can never disagree about who is on the roster.
    private List<RosterCsv.Row> rowsOf(String query, UUID membershipTypeId,
                                       Map<UUID, String> memberNumbers,
                                       Map<UUID, String> typeNames) {
        List<RosterCsv.Row> rows = new ArrayList<>();
        UUID cursor = null;
        do {
            CursorPage.Result<RosterService.RosterEntry> page =
                    roster.list(query, membershipTypeId, cursor, PAGE_SIZE);
            page.items().forEach(entry -> rows.add(rowOf(entry, memberNumbers, typeNames)));
            cursor = page.nextCursor();
        } while (cursor != null);
        return rows;
    }

    private RosterCsv.Row rowOf(RosterService.RosterEntry entry, Map<UUID, String> memberNumbers,
                                Map<UUID, String> typeNames) {
        RosterService.Membership membership = entry.membership();
        return new RosterCsv.Row(memberNumbers.get(entry.personId()), entry.firstName(),
                entry.lastName(), entry.email(),
                membership == null ? null : nameOf(membership.typeId(), typeNames),
                membership == null ? null : membership.startedOn(),
                membership == null ? null : membership.endedOn());
    }

    // A club has a handful of membership types and a roster of hundreds, so the name is asked for
    // once per type rather than once per person.
    private String nameOf(UUID membershipTypeId, Map<UUID, String> typeNames) {
        return typeNames.computeIfAbsent(membershipTypeId,
                id -> memberships.membershipTypeNameOf(id).orElse(""));
    }

    private Map<UUID, String> memberNumbersOf(UUID sourceId) {
        if (sourceId == null) {
            return Map.of();
        }
        sources.configurationOf(sourceId);
        Map<UUID, String> numbers = new HashMap<>();
        references.findBySourceId(sourceId)
                .forEach(reference -> numbers.put(reference.getPersonId(), reference.getExternalId()));
        return numbers;
    }
}
