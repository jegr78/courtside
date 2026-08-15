package org.courtside.identity;

final class AccountFixtures {

    private AccountFixtures() {
    }

    static UserAccount enabled(UserAccount account) {
        account.enable();
        return account;
    }
}
