package org.courtside.shared;

import java.util.Collection;
import java.util.Map;
import java.util.UUID;

public interface ConfigurationSubjectNames {

    Map<UUID, String> namesFor(Collection<UUID> subjectIds);
}
