package org.courtside.shared;

import org.springframework.boot.jackson.autoconfigure.JsonMapperBuilderCustomizer;
import org.springframework.stereotype.Component;
import tools.jackson.databind.cfg.CoercionAction;
import tools.jackson.databind.cfg.CoercionInputShape;
import tools.jackson.databind.cfg.MutableCoercionConfig;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.type.LogicalType;

import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

// The document declares a type per field, so a value of another JSON shape is a request the
// contract does not describe. A whole number stays a number, because JSON has only one of those.
// An empty string is the same mistake wearing Jackson's default: it silently becomes absence
// everywhere the field is not itself textual.
@Component
class RejectsCoercedScalars implements JsonMapperBuilderCustomizer {

    private static final Map<LogicalType, List<CoercionInputShape>> FOREIGN_SHAPES = Map.of(
            LogicalType.Integer,
            List.of(CoercionInputShape.String, CoercionInputShape.Float, CoercionInputShape.Boolean),
            LogicalType.Boolean,
            List.of(CoercionInputShape.String, CoercionInputShape.Integer, CoercionInputShape.Float),
            LogicalType.Float,
            List.of(CoercionInputShape.String, CoercionInputShape.Boolean),
            LogicalType.Textual,
            List.of(CoercionInputShape.Integer, CoercionInputShape.Float, CoercionInputShape.Boolean));

    @Override
    public void customize(JsonMapper.Builder builder) {
        builder.withCoercionConfigDefaults(refuse(List.of(CoercionInputShape.EmptyString)))
                .withCoercionConfig(LogicalType.Textual,
                        config -> config.setCoercion(CoercionInputShape.EmptyString, CoercionAction.AsEmpty));
        FOREIGN_SHAPES.forEach((type, shapes) -> builder.withCoercionConfig(type, refuse(shapes)));
    }

    private static Consumer<MutableCoercionConfig> refuse(List<CoercionInputShape> shapes) {
        return config -> shapes.forEach(shape -> config.setCoercion(shape, CoercionAction.Fail));
    }
}
