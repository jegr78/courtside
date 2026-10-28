package org.courtside.shared;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

import java.net.URI;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class InstanceAddressTest {

    @ParameterizedTest
    @CsvSource({
            "https://Courts.Example.org, https://courts.example.org, courts.example.org",
            "https://COURTS.EXAMPLE.ORG:8443/, https://courts.example.org:8443, courts.example.org",
            "https://Bücher.Example.org, https://xn--bcher-kva.example.org, xn--bcher-kva.example.org",
            "https://localhost:8443, https://localhost:8443, localhost"
    })
    void givenADomainInAnyCase_whenReadingTheAddress_thenOriginAndRelyingPartyIdAreLowerCaseAscii(
            String configured, String origin, String relyingPartyId) {
        // when
        var address = new InstanceAddress(configured);
        // then
        assertThat(address.origin()).as("origin of %s", configured).contains(URI.create(origin));
        assertThat(address.relyingPartyId()).as("relying-party id of %s", configured).contains(relyingPartyId);
    }

    @ParameterizedTest
    @CsvSource({
            "https://192.0.2.10, https://192.0.2.10",
            "https://192.0.2.10:8443, https://192.0.2.10:8443",
            "https://[2001:DB8::1], https://[2001:db8::1]",
            "https://[2001:db8::1]:8443, https://[2001:db8::1]:8443"
    })
    void givenAnIpAddressHost_whenReadingTheAddress_thenTheInstanceKeepsItsOriginButHasNoRelyingPartyId(
            String configured, String origin) {
        // when
        var address = new InstanceAddress(configured);
        // then
        assertThat(address.origin()).as("origin of %s", configured).contains(URI.create(origin));
        assertThat(address.relyingPartyId()).as("browsers refuse an IP address as relying-party id: %s", configured)
                .isEmpty();
    }

    @Test
    void givenNoConfiguredAddress_whenReadingTheAddress_thenNeitherOriginNorRelyingPartyIdExists() {
        // when
        var address = new InstanceAddress("");
        // then
        assertThat(address.origin()).isEmpty();
        assertThat(address.relyingPartyId()).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"http://courts.example.org", "https://courts.example.org/path",
            "https://user@courts.example.org", "https://courts.example.org?q=1", "https://courts.example.org:0"})
    void givenAnAddressThatIsNotAnHttpsOrigin_whenStarting_thenTheInstanceRefusesWithoutEchoingIt(String configured) {
        // when / then
        assertThatThrownBy(() -> new InstanceAddress(configured)).isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("COURTSIDE_PUBLIC_URL").hasMessageNotContaining(configured);
    }
}
