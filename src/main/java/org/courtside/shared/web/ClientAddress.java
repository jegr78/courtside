package org.courtside.shared.web;

import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.util.HexFormat;

final class ClientAddress {

    private ClientAddress() {
    }

    // One IPv6 subscriber holds a whole /64, so a budget per /128 would let it rotate freely.
    static String bucketOf(String remoteAddress) {
        InetAddress address;
        try {
            address = InetAddress.ofLiteral(remoteAddress);
        } catch (IllegalArgumentException notALiteral) {
            return remoteAddress;
        }
        if (address instanceof Inet6Address) {
            byte[] bytes = address.getAddress();
            return HexFormat.of().formatHex(bytes, 0, 8) + "/64";
        }
        return address instanceof Inet4Address ? address.getHostAddress() : remoteAddress;
    }
}
