# D2 suggest candidates

This document lists the D2 key and value candidates targeted by editor suggestions.
The source of truth is the bundled D2 module, `oss.terrastruct.com/d2 v0.7.1`.

## Key candidates

### Top-level and object attributes

- `label`
- `shape`
- `icon`
- `constraint`
- `tooltip`
- `link`
- `near`
- `width`
- `height`
- `direction`
- `top`
- `left`
- `grid-rows`
- `grid-columns`
- `grid-gap`
- `vertical-gap`
- `horizontal-gap`
- `class`
- `vars`

### Composite keys

- `style`
- `source-arrowhead`
- `target-arrowhead`
- `classes`
- `constraint`
- `label`
- `icon`
- `tooltip`

### Board keys

- `layers`
- `scenarios`
- `steps`

### Style keys

- `opacity`
- `stroke`
- `fill`
- `fill-pattern`
- `stroke-width`
- `stroke-dash`
- `border-radius`
- `font`
- `font-size`
- `font-color`
- `bold`
- `italic`
- `underline`
- `text-transform`
- `shadow`
- `multiple`
- `double-border`
- `3d`
- `animated`
- `filled`

### Arrowhead keys

- `shape`
- `label`
- `style.filled`

### Label, icon, and tooltip keys

- `near`

### Root vars keys

Under root `vars`:

- `d2-config`

### Root vars config keys

Under `vars.d2-config`:

- `sketch`
- `theme-id`
- `dark-theme-id`
- `pad`
- `layout-engine`
- `center`
- `theme-overrides`
- `dark-theme-overrides`
- `data`

Under `theme-overrides` and `dark-theme-overrides`:

- `N1`
- `N2`
- `N3`
- `N4`
- `N5`
- `N6`
- `N7`
- `B1`
- `B2`
- `B3`
- `B4`
- `B5`
- `B6`
- `AA2`
- `AA4`
- `AA5`
- `AB4`
- `AB5`

## Value candidates

### `direction`

- `up`
- `down`
- `right`
- `left`

### `shape`

- `rectangle`
- `square`
- `page`
- `parallelogram`
- `document`
- `cylinder`
- `queue`
- `package`
- `step`
- `callout`
- `stored_data`
- `person`
- `c4-person`
- `diamond`
- `oval`
- `circle`
- `hexagon`
- `cloud`
- `text`
- `code`
- `class`
- `sql_table`
- `image`
- `sequence_diagram`
- `hierarchy`

### Boolean values

- `true`
- `false`

Used by:

- `style.shadow`
- `style.3d`
- `style.multiple`
- `style.animated`
- `style.bold`
- `style.italic`
- `style.underline`
- `style.filled`
- `style.double-border`
- `vars.d2-config.sketch`
- `vars.d2-config.center`

### `fill-pattern`

- `none`
- `dots`
- `lines`
- `grain`
- `paper`

### `text-transform`

- `none`
- `uppercase`
- `lowercase`
- `capitalize`

Note: the D2 website mentions `title` in some examples, but the bundled D2
module validates `capitalize`.

### `font`

- `default`
- `mono`

### `source-arrowhead.shape` and `target-arrowhead.shape`

- `none`
- `arrow`
- `triangle`
- `diamond`
- `circle`
- `box`
- `cf-one`
- `cf-many`
- `cf-one-required`
- `cf-many-required`
- `cross`

### `near`

For object `near`:

- `top-left`
- `top-center`
- `top-right`
- `center-left`
- `center-right`
- `bottom-left`
- `bottom-center`
- `bottom-right`

For `label.near` and `icon.near`:

- `top-left`
- `top-center`
- `top-right`
- `center-left`
- `center-center`
- `center-right`
- `bottom-left`
- `bottom-center`
- `bottom-right`
- `outside-top-left`
- `outside-top-center`
- `outside-top-right`
- `outside-left-top`
- `outside-left-center`
- `outside-left-bottom`
- `outside-right-top`
- `outside-right-center`
- `outside-right-bottom`
- `outside-bottom-left`
- `outside-bottom-center`
- `outside-bottom-right`
- `border-top-left`
- `border-top-center`
- `border-top-right`
- `border-left-top`
- `border-left-center`
- `border-left-bottom`
- `border-right-top`
- `border-right-center`
- `border-right-bottom`
- `border-bottom-left`
- `border-bottom-center`
- `border-bottom-right`

For `tooltip.near`:

- `top-left`
- `top-center`
- `top-right`
- `center-left`
- `center-right`
- `bottom-left`
- `bottom-center`
- `bottom-right`

### Value hints

These are not finite value lists; suggestions should present examples or
placeholders:

- `opacity`: number between `0.0` and `1.0`
- `stroke-width`: number between `0` and `15`
- `font-size`: number between `8` and `100`
- `stroke-dash`: number between `0` and `10`
- `border-radius`: number greater than or equal to `0`
- `font-color`, `stroke`, `fill`: color name, hex code, or gradient
- `width`, `height`, `top`, `left`: pixels
- `grid-rows`, `grid-columns`: positive integer
- `grid-gap`, `vertical-gap`, `horizontal-gap`: non-negative integer
- `icon`: URL
- `tooltip`: markdown
- `link`: URL or board path
- `class`: declared class name or array of class names
- `layout-engine`: layout engine name
- `theme-id`: D2 light theme IDs, with theme names and color palettes
- `dark-theme-id`: D2 dark theme IDs, with theme names and color palettes
- `pad`: integer
- theme override values: color name or hex code
