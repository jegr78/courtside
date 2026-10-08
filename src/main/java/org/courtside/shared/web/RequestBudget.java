package org.courtside.shared.web;

record RequestBudget(int burst, int perSecond) {

    RequestBudget {
        if (burst < 1 || perSecond < 1) {
            throw new IllegalArgumentException("A request budget needs a positive burst and rate");
        }
    }
}
