package org.courtside.credit.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.ApiCreditAccountSearchRequest;
import org.courtside.api.ApiCreditEntry;
import org.courtside.api.ApiCreditEntryKind;
import org.courtside.api.ApiCreditEntryRequest;
import org.courtside.api.ApiCreditHolder;
import org.courtside.api.ApiCreditLedgerPage;
import org.courtside.api.CreditApi;
import org.courtside.credit.CreditEntryKind;
import org.courtside.credit.internal.CreditLedger;
import org.courtside.identity.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

@RestController
@RequiredArgsConstructor
class CreditController implements CreditApi {

    private final CreditLedger ledger;
    private final CurrentUser currentUser;

    @Override
    public ResponseEntity<ApiCreditLedgerPage> listOwnCredit(UUID cursor, Integer limit) {
        UUID accountId = currentUser.accountId()
                .orElseThrow(() -> new IllegalStateException("No authenticated account"));
        return ResponseEntity.ok(page(ledger.page(accountId, cursor, limit)));
    }

    @Override
    public ResponseEntity<List<ApiCreditHolder>> listCreditHolders() {
        return ResponseEntity.ok(holders(ledger.holders(null)));
    }

    @Override
    public ResponseEntity<List<ApiCreditHolder>> searchCreditAccounts(ApiCreditAccountSearchRequest request) {
        return ResponseEntity.ok(holders(ledger.holders(request.getQuery())));
    }

    private static List<ApiCreditHolder> holders(List<CreditLedger.CreditHolder> holders) {
        return holders.stream()
                .map(holder -> new ApiCreditHolder(holder.accountId(), holder.firstName(), holder.lastName(),
                        holder.email(), holder.balanceMinor(), holder.currency()))
                .toList();
    }

    @Override
    public ResponseEntity<ApiCreditLedgerPage> listCreditEntries(UUID accountId, UUID cursor, Integer limit) {
        return ResponseEntity.ok(page(ledger.pageOfAccount(accountId, cursor, limit)));
    }

    @Override
    public ResponseEntity<ApiCreditEntry> recordCreditEntry(UUID accountId, ApiCreditEntryRequest request) {
        CreditLedger.LedgerEntry entry = ledger.record(accountId, CreditEntryKind.valueOf(request.getKind().getValue()),
                request.getAmountMinor(), request.getNote());
        return ResponseEntity.status(HttpStatus.CREATED).body(entry(entry));
    }

    private static ApiCreditLedgerPage page(CreditLedger.LedgerPage page) {
        return new ApiCreditLedgerPage(page.balanceMinor(), page.currency(),
                page.items().stream().map(CreditController::entry).toList())
                .nextCursor(page.nextCursor());
    }

    private static ApiCreditEntry entry(CreditLedger.LedgerEntry entry) {
        return new ApiCreditEntry(entry.id(), ApiCreditEntryKind.fromValue(entry.kind().name()), entry.amountMinor(),
                entry.currency(), entry.balanceAfterMinor(), entry.recordedAt().atOffset(ZoneOffset.UTC))
                .note(entry.note());
    }
}
