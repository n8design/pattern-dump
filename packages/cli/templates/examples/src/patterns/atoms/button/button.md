---
title: Button
description: Triggers an action.
status: stable
---

Triggers an action. `variant` picks the emphasis.

Two kinds of variant live next to the base component:

- **`button~secondary.json`** only overrides data — same markup, different `label` and `variant`.
- **`button~icon.hbs`** has its own markup — an icon-only button that keeps `label` as its accessible name.

```pattern atoms/button
```

```pattern atoms/button~secondary
```

```pattern atoms/button~icon
```
