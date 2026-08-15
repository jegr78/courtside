package org.courtside.identity.internal;

import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class CourtsideUserDetailsService implements UserDetailsService {

    private static final String ROLE_PREFIX = "ROLE_";
    static final String PASSWORD_CHANGE_REQUIRED = "PASSWORD_CHANGE_REQUIRED";

    private final UserAccountRepository accounts;

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

        return new CourtsideUserDetails(account.getUsername(), account.getPasswordHash(),
                account.isEnabled(), authorities, account.getSecurityEpoch());
    }
}
