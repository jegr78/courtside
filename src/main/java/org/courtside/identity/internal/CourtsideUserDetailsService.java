package org.courtside.identity.internal;

import io.micrometer.core.instrument.MeterRegistry;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.NestedRuntimeException;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsPasswordService;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j
@Transactional(readOnly = true)
public class CourtsideUserDetailsService implements UserDetailsService, UserDetailsPasswordService {

    private static final String ROLE_PREFIX = "ROLE_";
    private static final String REHASH_FAILED = "courtside.password.rehash.failed";
    static final String PASSWORD_CHANGE_REQUIRED = "PASSWORD_CHANGE_REQUIRED";

    private final UserAccountRepository accounts;
    private final UnusablePassword unusablePassword;
    private final PasswordRehashWriter rehashWriter;
    private final MeterRegistry meters;
    private final Clock clock;

    @Override
    public UserDetails loadUserByUsername(String username) {
        UserAccount account = accounts.findByUsername(username)
                .orElseThrow(() -> new UsernameNotFoundException("Unknown account"));

        List<String> authorities = account.getRoles().stream()
                .map(role -> ROLE_PREFIX + role.name())
                .collect(Collectors.toCollection(ArrayList::new));
        if (account.isPasswordChangeRequired()) {
            authorities.add(PASSWORD_CHANGE_REQUIRED);
        }

        return new CourtsideUserDetails(account.getId(), account.getUsername(),
                passwordOf(account), account.isEnabled(),
                !account.isCredentialExpired(clock.instant()), authorities,
                account.getSecurityEpoch());
    }

    private String passwordOf(UserAccount account) {
        return account.getPasswordHash() == null
                ? unusablePassword.hash()
                : account.getPasswordHash();
    }

    @Override
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public UserDetails updatePassword(UserDetails user, String newPassword) {
        Optional<UserAccount> account;
        try {
            account = accounts.findByUsername(user.getUsername());
        } catch (NestedRuntimeException e) {
            countFailure("lookup");
            log.warn("Password rehash failed before the account could be read", e);
            return user;
        }
        account.ifPresent(found -> rehash(found, user, newPassword));
        return user;
    }

    private void rehash(UserAccount account, UserDetails user, String newPassword) {
        try {
            rehashWriter.rehash(account.getId(), user.getPassword(), newPassword);
        } catch (NestedRuntimeException e) {
            countFailure("write");
            log.warn("Password rehash failed for account {}", account.getId(), e);
        }
    }

    private void countFailure(String stage) {
        meters.counter(REHASH_FAILED, "stage", stage).increment();
    }
}
