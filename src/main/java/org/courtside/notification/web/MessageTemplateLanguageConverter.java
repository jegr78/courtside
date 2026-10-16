package org.courtside.notification.web;

import org.courtside.api.ApiMessageTemplateLanguage;
import org.springframework.core.convert.converter.Converter;
import org.springframework.stereotype.Component;

@Component
class MessageTemplateLanguageConverter implements Converter<String, ApiMessageTemplateLanguage> {

    @Override
    public ApiMessageTemplateLanguage convert(String language) {
        return ApiMessageTemplateLanguage.fromValue(language);
    }
}
