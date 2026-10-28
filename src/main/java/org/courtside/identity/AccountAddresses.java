package org.courtside.identity;

import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Locale;

@Service
@RequiredArgsConstructor
public class AccountAddresses {

    private final UserAccountRepository accounts;
    private final ApplicationEventPublisher events;

    @Transactional(propagation = Propagation.MANDATORY)
    public void change(Person person, String address) {
        if (person == null) {
            throw new IllegalStateException("A person is required to change an address");
        }
        String previous = person.getEmail();
        person.changeEmail(address);
        if (previous == null || previous.isBlank() || normalized(previous).equals(normalized(address))) {
            return;
        }
        accounts.findByPersonIdIn(List.of(person.getId()))
                .forEach(account -> events.publishEvent(new AccountAddressChanged(account.getId(), previous)));
    }

    private static String normalized(String address) {
        return address == null ? "" : address.strip().toLowerCase(Locale.ROOT);
    }
}
