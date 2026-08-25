# Frontend design

The court plan is the product surface. It answers whether a court is available at a particular
time before it asks a member to manage an account or a booking. Product screens therefore use the
court plan as their visual reference rather than a generic application component library.

## Colour

The structural palette has five named values:

| Token | Dark value | Meaning |
| --- | --- | --- |
| Shade | `#17211D` | Dark surfaces and text in the light theme |
| Clay | `#B85C38` | Standard occupied-court colour |
| Ball | `#D7E24B` | Own booking and deliberate attention |
| Line | `#FCFBF9` | Court lines, light surfaces and dark-theme text |
| Dust | `#E8DDD4` | Closed courts and quiet light-theme surfaces |

CSS uses semantic surface, text, border and form tokens derived from this palette. Dark is the
default theme. Light changes those semantic tokens but does not introduce a second palette. Large
gradients are not part of the product surface.

Club configuration controls the logo, name, primary action colour and focus accent. Club colours
must not replace free, own, occupied or closed court states. Action text is selected for contrast
against the configured primary colour.

## Type

Archivo is the product and interface typeface. Geist Mono is limited to times, dates and compact
values where tabular alignment carries meaning. Both variable fonts are bundled through Fontsource
and served by the application. Their SIL Open Font License 1.1 notices are distributed as
`font-licenses.txt` with the web client.

## Brand ownership

The configured club logo and club name lead the application. If no logo exists, the monochrome
Courtside court mark is the neutral fallback. Courtside's own identity remains subordinate in an
installed single-club instance.

A root-relative logo keeps the request within the club instance and is preferred. An HTTPS logo on
another origin remains supported for clubs without a local asset route, but its host receives the
visitor's IP address and the Courtside origin through the browser request. Plain HTTP logos are
rejected.

## Language and theme

German is the initial language and English is available at every point in the application. An
explicit browser choice wins over an account locale and persists locally. Theme selection follows
the same rule, with dark as the initial value. Neither preference depends on translated text or an
authenticated session.

## Accessibility

Colour is never the sole carrier of state. Interactive controls retain visible keyboard focus,
and reduced-motion preferences suppress non-essential transitions. Times use tabular numerals.
Modal surfaces, inputs and controls consume the same semantic tokens as the page instead of
maintaining theme-specific component variants.
