package org.courtside.shared.web;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration(proxyBeanMethods = false)
class SpaConfiguration implements WebMvcConfigurer {

    @Override
    public void addViewControllers(ViewControllerRegistry registry) {
        registry.addViewController("/").setViewName("forward:/index.html");
        registry.addViewController("/courts").setViewName("forward:/index.html");
        registry.addViewController("/login").setViewName("forward:/index.html");
        registry.addViewController("/initial-password").setViewName("forward:/index.html");
        registry.addViewController("/my-bookings").setViewName("forward:/index.html");
        registry.addViewController("/admin/configuration").setViewName("forward:/index.html");
        registry.addViewController("/admin/facility").setViewName("forward:/index.html");
        registry.addViewController("/admin/roster").setViewName("forward:/index.html");
        registry.addViewController("/admin/roster/{personId}").setViewName("forward:/index.html");
        registry.addViewController("/admin/membership-types").setViewName("forward:/index.html");
        registry.addViewController("/admin/import").setViewName("forward:/index.html");
        registry.addViewController("/admin/audit").setViewName("forward:/index.html");
    }
}
