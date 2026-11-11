package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.AccountAnonymisation;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.Outsiders;
import org.courtside.identity.RecentAuthentication;
import org.courtside.identity.UserAccount;
import org.courtside.shared.AccountClosed;
import org.courtside.shared.HeldCredit;
import org.courtside.shared.PaymentsInFlight;
import org.courtside.shared.UpcomingBookings;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
class AccountClosure {

    private final CurrentUser currentUser;
    private final RecentAuthentication recentAuthentication;
    private final Outsiders outsiders;
    private final UpcomingBookings upcomingBookings;
    private final HeldCredit heldCredit;
    private final PaymentsInFlight paymentsInFlight;
    private final AccountAnonymisation anonymisation;
    private final ApplicationEventPublisher events;

    @Transactional
    void closeOwn() {
        recentAuthentication.requireRecent();
        UserAccount account = currentUser.requireAccountForUpdate();
        if (!outsiders.isOutsider(account.getId(), account.getRoles())) {
            throw new AccountClosureNotOpenException();
        }
        // A refund or capture changes the ledger under this lock, so the checks below read its settled result.
        heldCredit.lock(account.getId());
        if (upcomingBookings.heldBy(account.getId())) {
            throw new AccountClosureBlockedByBookingException();
        }
        PaymentsInFlight.MoneyHeld held = paymentsInFlight.moneyHeldBy(account.getId());
        if (held.credit()) {
            throw new AccountClosureBlockedByCreditException();
        }
        if (held.payment()) {
            throw new AccountClosureBlockedByPaymentException();
        }
        anonymisation.anonymise(account.getId());
        events.publishEvent(new AccountClosed(account.getId()));
    }
}
