package org.courtside.identity.internal;

import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.NestedRuntimeException;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsPasswordService;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

@Service
@RequiredArgsConstructor
@Slf4j
@Transactional(readOnly = true)
public class CourtsideUserDetailsService implements UserDetailsService, UserDetailsPasswordService {

    private static final String ROLE_PREFIX = "ROLE_";
    static final String PASSWORD_CHANGE_REQUIRED = "PASSWORD_CHANGE_REQUIRED";

    private final UserAccountRepository accounts;
    private final PasswordRehashWriter rehashWriter;

    @Override
    public UserDetails loadUserByUsername(String username) {
        UserAccount account = accounts.findByUsername(username)
                .orElseThrow(() -> new UsernameNotFoundException("Unknown account"));

        List<String> authorities = account.getRoles().stream()
                .map(role -> ROLE_PREFIX + role.name())
                .collect(java.util.stream.Collectors.toCollection(ArrayList::new));
        if (account.isPasswordChangeRequired()) {
            authorities.add(PASSWORD_CHANGE_REQUIRED);
        }

        return User.withUsername(account.getUsername())
                .password(account.getPasswordHash())
                .disabled(!account.isEnabled())
                .authorities(authorities.toArray(String[]::new))
                .build();
    }

    @Override
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public UserDetails updatePassword(UserDetails user, String newPassword) {
        Optional<UserAccount> account;
        try {
            account = accounts.findByUsername(user.getUsername());
        } catch (NestedRuntimeException e) {
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
            log.warn("Password rehash failed for account {}", account.getId(), e);
        }
    }
}
