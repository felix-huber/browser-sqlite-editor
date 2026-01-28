# /ui — UI Exploration (Tasteboard + Keystone + Variants)

## Goal
Explore UI direction through visual references, then generate keystone screen and variants.

## Prerequisites
- `artifacts/02-ux.md` should exist (know what screens we need)
- Recommended: `/oracle ux` completed (UX reviewed)

## Outputs
- `artifacts/05-design/tasteboard.md` — Visual references and principles
- `artifacts/05-design/keystone.html` — Primary screen implementation
- `artifacts/05-design/variants/*.html` — 6-12 design alternatives
- `artifacts/05-design/manifest.json` — Gallery manifest

## Phase 1: Tasteboard (Human Step)

### 1. Start tasteboard server
Tell the human:

```bash
# Start the server from project root
npm run tasteboard
# Open http://localhost:8080/tools/tasteboard/
```

### 2. Guide tasteboard usage
The human should add:
- **Typography references**: Fonts, sizes, hierarchy examples
- **Color references**: Palettes, themes, mood boards
- **Layout references**: Grids, spacing, composition examples
- **Component references**: Buttons, cards, forms from admired products
- **Animation references**: Motion patterns, transitions

### 3. Export tasteboard
Human clicks "Export Markdown" in the tool.
Save to: `artifacts/05-design/tasteboard.md`

### 4. Read and synthesize
Once `artifacts/05-design/tasteboard.md` exists:
- Extract 3-5 design principles
- Identify dominant patterns (dark/light, minimal/rich, etc.)
- Note specific inspirations to incorporate

## Phase 2: Keystone Screen

### 1. Identify keystone
The keystone is the **most important screen** — usually:
- The main workspace/editor
- The primary dashboard
- The core interaction surface

Ask user if unclear: "Which screen should be the keystone?"

### 2. Generate keystone HTML
Create `artifacts/05-design/keystone.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>[App Name] — Keystone</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    /* Custom styles based on tasteboard */
  </style>
</head>
<body class="...">
  <!-- Implement the keystone screen -->
  <!-- Use tasteboard principles -->
  <!-- Include all states from UX spec -->
</body>
</html>
```

Guidelines:
- Use Tailwind CSS for rapid iteration
- Incorporate tasteboard principles
- Show the "success" state by default
- Include realistic placeholder content
- Make it responsive

## Phase 3: Variants

### 1. Generate 6-12 variants
Create variations exploring:

| Variant | Exploration |
|---------|-------------|
| `variant-01-dark.html` | Dark theme |
| `variant-02-light.html` | Light theme |
| `variant-03-minimal.html` | Minimal UI, maximum content |
| `variant-04-rich.html` | Rich UI, dense information |
| `variant-05-playful.html` | Rounded, colorful, animated |
| `variant-06-corporate.html` | Sharp, professional, restrained |
| `variant-07-mobile.html` | Mobile-first layout |
| `variant-08-dense.html` | Information-dense for power users |

Save each to: `artifacts/05-design/variants/`

### 2. Build manifest
```bash
node scripts/design_manifest_build.js
```

This creates `artifacts/05-design/manifest.json`:
```json
{
  "generatedAt": "2026-01-27T...",
  "keystone": {
    "file": "keystone.html",
    "title": "App Name — Keystone",
    "description": "Primary screen (keystone)"
  },
  "variants": [
    { "file": "variants/variant-01-dark.html", "title": "Dark Theme", "description": "Dark" },
    { "file": "variants/variant-02-light.html", "title": "Light Theme", "description": "Light" }
  ],
  "tasteboard": "tasteboard.md",
  "counts": { "keystone": 1, "variants": 8, "total": 9 }
}
```

## Phase 4: Design Gallery (Human Step)

### 1. Start gallery server
Tell the human:

```bash
# Start the server from project root
npm run gallery
# Open http://localhost:8080/tools/design-gallery/
```

### 2. Review variants
Human reviews all variants side-by-side and selects:
- Primary direction (becomes new keystone)
- Elements to incorporate from other variants

### 3. Iterate
If needed, generate additional variants based on feedback.

## Phase 5: Converge

### 1. Update keystone
Incorporate selected elements from variants into final keystone.

### 2. Document decisions
Add to `artifacts/05-design/tasteboard.md`:

```markdown
## Final Direction

**Selected variant**: variant-03-minimal.html

**Key decisions**:
- Dark theme with high contrast
- Minimal chrome, maximum content area
- Subtle animations on interactions
- Mobile-responsive with bottom navigation

**Incorporated from other variants**:
- Card style from variant-05-playful
- Typography scale from variant-06-corporate
```

## Next step
Tell user: "UI exploration complete. Run `/plan` to generate implementation plan."

Or if UX needs update based on design decisions:
"UI exploration complete. Consider running `/oracle ux` again to validate UX against design direction."
