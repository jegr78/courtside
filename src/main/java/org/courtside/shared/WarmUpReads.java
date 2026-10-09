package org.courtside.shared;

import java.util.List;

/** Anonymous GET paths the warm-up requests from the instance's own port before it reports ready. */
public interface WarmUpReads {

    String name();

    List<String> paths();
}
