---
title: Markdown Specimen
description: Kitchen-sink doc exercising every supported Markdown element — the styling target for the design-tokens milestone.
status: stable
---

# Heading 1
## Heading 2
### Heading 3
#### Heading 4
##### Heading 5
###### Heading 6

---

Body paragraph with **bold**, *italic*, and ~~strikethrough~~. Inline `code` and a [relative link](#heading-2). An [external link](https://example.com) for good measure.

---

## Unordered list

- Alpha
- Beta
  - Nested Beta-1
  - Nested Beta-2
    - Deeply nested
- Gamma

## Ordered list

1. First
2. Second
   1. Nested 2a
   2. Nested 2b
3. Third

## Blockquote

> This is a blockquote.
> It spans multiple lines.
>
> And has a second paragraph inside.

## Table

| Name      | Type    | Default   | Description              |
|-----------|---------|-----------|--------------------------|
| `label`   | string  | —         | Button text              |
| `variant` | string  | `primary` | Visual style             |
| `disabled`| boolean | `false`   | Prevents interaction     |

## Fenced code — TypeScript

```typescript
function greet(name: string): string {
  return `Hello, ${name}!`;
}

const result = greet("world");
console.log(result); // Hello, world!
```

## Fenced code — Handlebars

```handlebars
{{#if isActive}}
  <span class="badge badge--active">{{label}}</span>
{{else}}
  <span class="badge">{{label}}</span>
{{/if}}
```

## Pattern cross-links

[Button component](pattern:atoms/button) — resolved link, navigates SPA.  
[Secondary variant](pattern:atoms/button~secondary) — resolved with variant.  
[Missing component](pattern:atoms/no-such-component) — unresolved, broken state.

## Pattern embeds

```pattern atoms/button
```

```pattern atoms/button~secondary
```

## Source embeds

### Template (variant suffix ignored — all variants share the base template)

```src-template atoms/button
```

```src-template atoms/button~secondary
```

### Data (base)

```src-data atoms/button
```

### Data (variant)

```src-data atoms/button~secondary
```

### HTML output (base)

```src-html atoms/button
```

### HTML output (variant)

```src-html atoms/button~secondary
```

### Error states

```src-template atoms/no-such-component
```

```src-data atoms/button~no-such-variant
```

```src-html atoms/no-such-component
```
