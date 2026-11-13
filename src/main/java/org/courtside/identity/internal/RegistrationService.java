package org.courtside.identity.internal;

import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.courtside.config.ExternalBookings;
import org.courtside.identity.AccountAddressChanged;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.shared.DatabaseDeadlines;
import org.courtside.shared.InstanceAddress;
import org.courtside.shared.IssuedRegistrationCode;
import org.courtside.shared.RegistrationCodeIssuer;
import org.courtside.shared.RegistrationNameTaken;
import org.courtside.shared.RegistrationVerificationRequested;
import org.courtside.shared.RegistrationVerified;
import org.courtside.shared.SqlConstraintViolation;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.event.EventListener;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
class RegistrationService implements RegistrationCodeIssuer {

    static final Duration VERIFICATION_WINDOW = Duration.ofHours(24);
    private static final String UNIQUE_USERNAME = "user_account_unique_username";

    private final ExternalBookings externalBookings;
    private final InstanceAddress address;
    private final LoginAttemptProtection protection;
    private final PasswordPolicy passwordPolicy;
    private final PasswordEncoder passwordEncoder;
    private final PersonRepository people;
    private final UserAccountRepository accounts;
    private final RegistrationVerificationRepository verifications;
    private final ApplicationEventPublisher events;
    private final TransactionTemplate transactions;
    private final DatabaseDeadlines deadlines;
    private final EntityManager entities;
    private final Clock clock;

    record Registration(String firstName, String lastName, String username, String password, String email,
                        String language) {
    }

    void register(Registration registration, String callerAddress) {
        if (!externalBookings.admitted() || address.origin().isEmpty()) {
            throw new RegistrationClosedException();
        }
        protection.registerRegistrationAttempt(registration.email(), callerAddress).ifPresent(block -> {
            throw new RegistrationRateLimitedException(block);
        });
        Person person = new Person(registration.firstName(), registration.lastName(), registration.email());
        passwordPolicy.requireUnguessable(registration.password(),
                UserAccount.awaitingCredentials(person, registration.username(), Set.of(Role.EXTERNAL),
                        registration.language()));
        String passwordHash = passwordEncoder.encode(registration.password());
        if (accounts.findByUsername(registration.username()).isPresent()) {
            reportTakenName(registration);
            return;
        }
        UserAccount account = new UserAccount(person, registration.username(), passwordHash, Set.of(Role.EXTERNAL),
                registration.language());
        try {
            transactions.executeWithoutResult(status -> {
                people.save(person);
                accounts.saveAndFlush(account);
                Instant now = clock.instant();
                verifications.save(new RegistrationVerification(account.getId(), account.getSecurityEpoch(), now,
                        now.plus(VERIFICATION_WINDOW)));
                events.publishEvent(new RegistrationVerificationRequested(account.getId()));
            });
        } catch (DataIntegrityViolationException raced) {
            if (!SqlConstraintViolation.matches(raced, SqlConstraintViolation.UNIQUE_VIOLATION, UNIQUE_USERNAME)) {
                throw raced;
            }
            reportTakenName(registration);
        }
    }

    private void reportTakenName(Registration registration) {
        transactions.executeWithoutResult(status -> accounts.findByUsername(registration.username())
                .ifPresent(holder -> events.publishEvent(new RegistrationNameTaken(
                        holder.getId(), registration.email(), registration.language()))));
    }

    @Transactional
    void verify(String code) {
        if (!externalBookings.admitted()) {
            throw new RegistrationClosedException();
        }
        String codeHash = ResetCodes.fingerprint(code);
        RegistrationVerification pending = verifications.findByCodeHash(codeHash)
                .orElseThrow(RegistrationCodeInvalidException::new);
        if (pending.hasExpiredBy(clock.instant())) {
            throw new RegistrationCodeExpiredException();
        }
        if (!pending.stillDescribes(accountOf(pending)) || verifications.deleteByCodeHash(codeHash) != 1) {
            throw new RegistrationCodeInvalidException();
        }
        accountOf(pending).enable();
        events.publishEvent(new RegistrationVerified(pending.getAccountId()));
    }

    private UserAccount accountOf(RegistrationVerification pending) {
        return accounts.findById(pending.getAccountId())
                .orElseThrow(() -> new IllegalStateException("A pending registration lost its account"));
    }

    @Override
    @Transactional
    public Optional<IssuedRegistrationCode> issueFor(UUID accountId) {
        return verifications.findById(accountId)
                .filter(pending -> !pending.hasExpiredBy(clock.instant()))
                .flatMap(pending -> accounts.findById(accountId).map(account -> {
                    String code = ResetCodes.generate();
                    pending.issue(ResetCodes.fingerprint(code));
                    return new IssuedRegistrationCode(account.getPerson().getEmail(), account.getLocale(), code,
                            pending.getExpiresAt());
                }));
    }

    // The mailed link went to the address just corrected, so the corrected one gets a fresh window.
    @EventListener
    void on(AccountAddressChanged changed) {
        verifications.findById(changed.accountId())
                .filter(pending -> !accountOf(pending).isEnabled())
                .ifPresent(pending -> {
                    pending.withdraw(clock.instant().plus(VERIFICATION_WINDOW));
                    events.publishEvent(new RegistrationVerificationRequested(pending.getAccountId()));
                });
    }

    int deleteExpired() {
        Instant now = clock.instant();
        List<UUID> expired = transactions.execute(status -> {
            deadlines.allowMaintenanceStatements();
            return verifications.expiredUnverifiedAccounts(now);
        });
        TransactionTemplate isolated = new TransactionTemplate(transactions.getTransactionManager());
        isolated.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        int removed = 0;
        for (UUID accountId : expired) {
            try {
                if (Boolean.TRUE.equals(isolated.execute(status -> deleteIfUntouched(accountId, now)))) {
                    removed++;
                }
            } catch (DataIntegrityViolationException referenced) {
                log.info("Kept unverified account {} because other records refer to its person", accountId);
            }
        }
        transactions.executeWithoutResult(status -> {
            deadlines.allowMaintenanceStatements();
            verifications.deleteExpired(now);
        });
        return removed;
    }

    private boolean deleteIfUntouched(UUID accountId, Instant now) {
        UserAccount account = entities.find(UserAccount.class, accountId, LockModeType.PESSIMISTIC_WRITE);
        if (account == null) {
            return false;
        }
        boolean untouched = verifications.findById(accountId)
                .filter(pending -> pending.hasExpiredBy(now) && pending.untouchedIn(account))
                .isPresent();
        if (!untouched) {
            return false;
        }
        UUID personId = account.getPerson().getId();
        accounts.delete(account);
        accounts.flush();
        people.deleteById(personId);
        people.flush();
        return true;
    }
}
