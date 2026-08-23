package org.courtside.identity.internal;

import org.courtside.identity.CurrentUser;
import org.courtside.identity.UserAccount;
import org.courtside.shared.SupportedLanguages;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
class AccountLocaleService {

    private final CurrentUser currentUser;
    private final SupportedLanguages languages;

    @Transactional
    void change(String locale) {
        languages.require(locale);
        UserAccount account = currentUser.requireAccount();
        account.changeLocale(locale);
    }
}
