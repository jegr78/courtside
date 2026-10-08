package org.courtside.shared.web;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class ClientAddressTest {

    @Test
    void givenTwoAddressesInOneIpv6Prefix_whenBucketing_thenTheyShareABudget() {
        // when
        String first = ClientAddress.bucketOf("2001:db8:1:2:aaaa::1");
        String second = ClientAddress.bucketOf("2001:db8:1:2:bbbb::2");

        // then
        assertThat(first).as("a /64 is one subscriber").isEqualTo(second).isEqualTo("20010db800010002/64");
        assertThat(ClientAddress.bucketOf("2001:db8:1:3::1")).as("the next /64 is someone else").isNotEqualTo(first);
    }

    @Test
    void givenIpv4Addresses_whenBucketing_thenEachAddressIsItsOwnBudget() {
        // when / then
        assertThat(ClientAddress.bucketOf("192.0.2.10")).isEqualTo("192.0.2.10");
        assertThat(ClientAddress.bucketOf("::ffff:192.0.2.10")).as("a mapped IPv4 address is that address")
                .isEqualTo("192.0.2.10");
        assertThat(ClientAddress.bucketOf("192.0.2.11")).isNotEqualTo(ClientAddress.bucketOf("192.0.2.10"));
    }

    @Test
    void givenSomethingThatIsNoAddressLiteral_whenBucketing_thenItIsKeptAsGivenWithoutALookup() {
        // when / then
        assertThat(ClientAddress.bucketOf("proxy.example.org")).isEqualTo("proxy.example.org");
    }
}
