package org.courtside.identity.internal;

import org.courtside.identity.CurrentUser;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.Session;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
class InitialPasswordService {

    private final CurrentUser currentUser;
    private final UserAccountRepository accounts;
    private final PasswordEncoder passwordEncoder;
    private final FindByIndexNameSessionRepository<? extends Session> sessions;

    @Transactional
    void change(String password) {
        UserAccount account = currentUser.requireAccount();
        String passwordHash = passwordEncoder.encode(password);
        if (accounts.changeInitialPassword(account.getId(), passwordHash) != 1) {
            throw new IllegalStateException("The initial password was already changed");
        }
        sessions.findByPrincipalName(account.getUsername()).keySet().forEach(sessions::deleteById);
    }
}
