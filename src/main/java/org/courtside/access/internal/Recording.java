package org.courtside.access.internal;

/** A recorded answer: what the pass does next, and which transitions the grant just went through. */
record Recording(PassEffect effect, boolean replaceCode, boolean firstAccepted, boolean becameFailing) {

    Recording(PassEffect effect, boolean replaceCode) {
        this(effect, replaceCode, false, false);
    }
}
