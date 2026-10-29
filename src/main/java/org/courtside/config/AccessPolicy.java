package org.courtside.config;

public interface AccessPolicy {

    AccessLeadTime accessLead();

    AccessLagTime accessLag();

    AccessCodeLength accessCodeLength();
}
