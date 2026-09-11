package org.courtside.shared;

import org.springframework.boot.jackson.autoconfigure.JsonMapperBuilderCustomizer;
import org.springframework.stereotype.Component;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.json.JsonMapper;

// A body naming one field twice has two readings and the reader silently took the later one.
@Component
class RejectsRepeatedFields implements JsonMapperBuilderCustomizer {

    @Override
    public void customize(JsonMapper.Builder builder) {
        builder.enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION);
    }
}
