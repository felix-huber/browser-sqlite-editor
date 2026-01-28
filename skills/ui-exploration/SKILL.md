---
name: ui-exploration
description: PROACTIVELY generate 10+ diverse UI design directions based on PRD/UX context, create HTML prototypes, and present for selection. DO NOT passively wait for user input - the AI generates the designs.
triggers:
  - ui exploration
  - design direction
  - ui variants
  - keystone
  - design generation
  - ui mockup
  - html prototype
  - tasteboard
---

# UI Exploration Skill (Proactive Generation)

---

## ⚠️⚠️⚠️ CRITICAL — ALL VARIANTS MUST SHOW THE SAME SCREEN ⚠️⚠️⚠️

**Every variant shows the EXACT SAME primary screen in a DIFFERENT visual style.**

```
✅ CORRECT:                          ❌ WRONG:
├── 01-swiss.html      (data grid)   ├── 01-data-grid.html
├── 02-dark-mode.html  (data grid)   ├── 02-sql-editor.html
├── 03-neobrutalist.html (data grid) ├── 03-erd-view.html
└── ...                              └── ...
```

**Purpose: "Which STYLE do I want?" NOT "Which SCREEN should I build?"**

Pick ONE screen (main workspace) and render it 10-12 times with different visual styles.

---

**This is NOT a passive tool.** The AI should:
1. Read the PRD and UX spec to understand the app
2. Generate 10+ diverse design directions automatically
3. Create actual HTML prototypes for each (ALL SHOWING THE SAME SCREEN)
4. Present them in a gallery for comparison

The user should NOT have to find inspiration. The AI generates diverse options proactively.

---

## Phase 1: Context Extraction (Automatic)

**First, read and understand the app:**

```bash
cat artifacts/01-prd.md | head -200
cat artifacts/02-ux.md | head -200
```

**Extract these insights:**

| Insight | Example (SQLite Editor) |
|---------|------------------------|
| App type | Database editor / developer tool |
| Target users | Developers, data analysts, technical users |
| Primary screen | Three-panel workspace (sidebar, data grid, query panel) |
| Key UI elements | Data grids, tree navigation, SQL editor, ERD canvas |
| Interaction style | Keyboard-first, power-user focused |
| Emotional tone | Professional, efficient, trustworthy |

---

## Phase 2: Design Direction Generation

**Generate 10-12 directions using diverse styles.**

### Style Pool (Ensure Variety!)

| Style | Best For | Feeling |
|-------|----------|---------|
| Swiss/International | Technical tools | Clean, systematic, professional |
| Dark Mode First | Developer tools | Focused, modern, low eye strain |
| Minimal | Focus apps | Distraction-free, content-first |
| Neobrutalist | Bold tools | Raw, distinctive, memorable |
| Glassmorphism | Layered UIs | Modern, depth, sophistication |
| Material | Accessible apps | Familiar, friendly, tactile |
| Corporate Professional | Enterprise | Trust, stability, refined |
| Tech Forward | Innovative tools | Cutting-edge, future-focused |
| Monochromatic | Focused apps | Unified, calm, professional |
| Editorial | Content-heavy | Readable, sophisticated |
| Bauhaus | Functional tools | Geometric, purposeful |
| Scandinavian | Approachable tools | Warm, minimal, human |

### Direction Template

For each direction, document:

```markdown
## Direction [N]: [Style Name]

**Emotional Concept**: 
[What FEELING should users experience? What mood does this create?]

**Visual Philosophy**:
[How should typography feel? What sensation do interactions create?
How does the interface emotionally support the user's workflow?]

**Abstract References**:
[Conceptual inspiration - architectural styles, cultural movements,
premium experiences that embody this aesthetic. NO brand names.]

**Color Palette**:
- Background: #...
- Surface: #...
- Primary: #...
- Text: #...
- Accent: #...

**Typography**:
- Headings: [font], [weight]
- Body: [font], [weight]  
- Mono: [font]
```

---

## Phase 3: HTML Prototype Generation

**For EACH direction, create a complete HTML prototype.**

### ⚠️⚠️⚠️ CRITICAL: SAME SCREEN, DIFFERENT STYLES ⚠️⚠️⚠️

**ALL 12 variants show the EXACT SAME PRIMARY SCREEN.**

For a SQLite editor, EVERY variant shows:
- Main three-panel workspace
- Sidebar with database tree (same databases, same tables)
- Data grid with same table data (same columns, same rows)
- Same status bar, same toolbar

The ONLY difference is the **VISUAL STYLE**:
```
01-swiss.html         → Swiss style (clean grids, Helvetica)
02-dark-mode.html     → Dark mode style (dark bg, high contrast)
03-neobrutalist.html  → Neobrutalist style (bold borders, raw)
04-glassmorphism.html → Glassmorphism style (blur, translucent)
... all showing the SAME screen layout with SAME content
```

**DO NOT create:**
- ❌ Variant showing ERD view
- ❌ Variant showing Table Designer
- ❌ Variant showing SQL Editor
- ❌ Variant showing Welcome screen

**The purpose is style comparison, not feature showcase.**

### Critical Guidelines

1. **Same screen for all** — Show the PRIMARY SCREEN from UX spec in each style
2. **Same content for all** — Use identical table names, data, sidebar state
3. **Realistic content** — Use actual table names, SQL queries, data (not Lorem ipsum)
4. **Capture the FEELING** — Not just colors, but spacing, typography, interactions
5. **Include states** — Hover effects, focus indicators, active states
6. **Make it REAL** — Should look like a screenshot of a working app

### File Structure

```
artifacts/05-design/
├── design-directions.md      # Written concepts for all directions
├── keystone.html             # Final selected design
├── tasteboard.md             # Final documented decisions
├── manifest.json             # Gallery metadata
└── variants/
    ├── 01-swiss-international.html
    ├── 02-dark-mode-first.html
    ├── 03-minimal.html
    ├── 04-neobrutalist.html
    ├── 05-glassmorphism.html
    ├── 06-material.html
    ├── 07-corporate-professional.html
    ├── 08-tech-forward.html
    ├── 09-monochromatic.html
    ├── 10-editorial.html
    ├── 11-bauhaus.html
    └── 12-scandinavian.html
```

### HTML Template

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>[App Name] — [Style Name]</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <style>
    /* 
     * Design Direction: [Style Name]
     * Emotional Concept: [Brief summary]
     */
    
    @import url('https://fonts.googleapis.com/css2?family=...');
    
    :root {
      --bg: #...;
      --surface: #...;
      --primary: #...;
      --text: #...;
      --text-muted: #...;
      --accent: #...;
      --border: #...;
    }
    
    * { box-sizing: border-box; }
    
    body {
      font-family: '...', system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    
    /* Interactions */
    .interactive {
      transition: all 150ms ease;
    }
    .interactive:hover {
      /* hover state */
    }
    .interactive:focus {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
  </style>
</head>
<body>
  <!-- 
    IMPLEMENT THE PRIMARY SCREEN FROM UX SPEC
    
    For a SQLite editor, this would be:
    - Left: Sidebar with database tree
    - Center: Data grid with realistic table data
    - Right/Bottom: Query panel or details
    
    Show it in "active working" state with:
    - A database selected
    - A table open with data
    - Realistic column names and values
  -->
</body>
</html>
```

---

## Phase 4: Gallery Presentation

**Build manifest and open gallery:**

```bash
node scripts/design_manifest_build.js
python -m http.server 8080 --directory . &
open http://localhost:8080/tools/design-gallery/
```

**Tell the user:**

```
I've generated 12 design directions for [App Name].

Each shows the main [primary screen] in a different design style:

1. Swiss/International — Clean, grid-based, systematic
2. Dark Mode First — Developer-focused, low eye strain
3. Minimal — Maximum content, minimum chrome
4. Neobrutalist — Bold, raw, distinctive
5. Glassmorphism — Layered, modern, depth
6. Material — Familiar, tactile, friendly
7. Corporate Professional — Trust, stability
8. Tech Forward — Cutting-edge, innovative
9. Monochromatic — Unified, focused
10. Editorial — Readable, sophisticated
11. Bauhaus — Geometric, functional
12. Scandinavian — Warm, human, minimal

Open the gallery to compare them side-by-side.

Which direction(s) resonate with you? I can also combine elements 
from different variants.
```

---

## Phase 5: Convergence

### Get User Selection

Ask: "Which direction(s) do you prefer? Any elements to combine from others?"

### Create Final Keystone

Based on selection:
1. Use selected direction as base
2. Incorporate requested elements from other variants
3. Polish details based on feedback
4. Save as `artifacts/05-design/keystone.html`

### Document Decisions

Create `artifacts/05-design/tasteboard.md`:

```markdown
# Design Direction — [App Name]

## Selected Style: [Style Name]

## Why This Direction
[1-2 sentences on why this fits the app and users]

## Design Principles
1. [Principle]
2. [Principle]
3. [Principle]

## Color Palette
| Role | Color | Usage |
|------|-------|-------|
| Background | #... | Page background |
| Surface | #... | Cards, panels |
| Primary | #... | Actions, links |
| Text | #... | Body text |
| Muted | #... | Secondary text |
| Accent | #... | Highlights, focus |
| Border | #... | Dividers, outlines |

## Typography
- **Headings**: [Font], [weights]
- **Body**: [Font], [weights]
- **Mono**: [Font] (for code/data)
- **Scale**: [base size, scale ratio]

## Spacing
- Base unit: [4px/8px]
- Component padding: [values]
- Section gaps: [values]

## Interactions
- Hover: [description]
- Focus: [description]
- Active: [description]
- Transitions: [timing]

## Elements from Other Variants
- [From variant X: element Y]
```

---

## Alternative: Browser-Assisted Exploration

### Option A: Search Real References

```bash
# Use browser to find Dribbble/Behance inspiration
agent-browser open "https://dribbble.com/search/[app-type]-ui"
```

Screenshot inspiring designs to inform generated variants.

### Option B: Oracle-Generated Concepts

```bash
# Have GPT-5.2 Pro generate design concepts
./scripts/oracle_browser_run.sh "Generate 10 distinct visual design 
directions for a [app type]. For each: style name, emotional concept, 
color palette (hex), typography, and detailed description of the 
main [primary screen]."
```

---

## Key Insight

**The AI does the creative work.** The user just picks from generated options.

Don't make the user:
- ❌ Manually search for inspiration
- ❌ Fill out forms with references
- ❌ Describe what they want in detail

Instead:
- ✅ Generate diverse options automatically
- ✅ Show actual working prototypes
- ✅ Let them react and select
- ✅ Iterate based on feedback
