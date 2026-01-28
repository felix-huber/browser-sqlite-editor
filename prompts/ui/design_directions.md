# Design Direction Generation Prompt

Use this prompt to generate diverse UI design directions. Can be used directly by Claude or sent to Oracle (GPT-5.2 Pro).

---

## ⚠️ CRITICAL: ALL DIRECTIONS DESCRIBE THE SAME SCREEN

When generating HTML variants from these directions, you must render the **SAME primary screen** in each style. The directions describe VISUAL STYLES, not different screens.

Example for a SQLite Editor:
- All 12 HTML files show the THREE-PANEL WORKSPACE (sidebar + data grid + query panel)
- Each file uses a different color palette, typography, spacing, etc.
- DO NOT create separate files for "ERD View", "Table Designer", etc.

---

## Context Input

Before running, extract these from the PRD/UX spec:

```
APP_TYPE: [e.g., "SQLite database editor"]
TARGET_USERS: [e.g., "developers, data analysts, technical users"]
PRIMARY_SCREEN: [e.g., "three-panel workspace with sidebar, data grid, and query panel"]
KEY_UI_ELEMENTS: [e.g., "data grids, tree navigation, SQL editor with syntax highlighting, ERD canvas"]
INTERACTION_STYLE: [e.g., "keyboard-first, power-user focused, desktop-optimized"]
EMOTIONAL_TONE: [e.g., "professional, efficient, trustworthy"]
```

---

## Generation Prompt

```
You are a senior UI/UX designer tasked with generating diverse design directions for a new application.

## Application Context
- **App Type**: {APP_TYPE}
- **Target Users**: {TARGET_USERS}
- **Primary Screen**: {PRIMARY_SCREEN}
- **Key UI Elements**: {KEY_UI_ELEMENTS}
- **Interaction Style**: {INTERACTION_STYLE}
- **Desired Emotional Tone**: {EMOTIONAL_TONE}

## Your Task

Generate **12 distinct design directions**. Each direction should represent a completely different visual and emotional approach to this application.

For EACH direction, provide:

### 1. Style Name
A concise, evocative name (e.g., "Dark Mode First", "Swiss International", "Neobrutalist")

### 2. Emotional Concept (1 paragraph)
Describe the FEELING this design evokes. What mood should users experience as they arrive? How should the visual hierarchy make them feel as they work? What emotional journey does the interface take them through?

### 3. Visual Philosophy (1 paragraph)
Explain how typography should FEEL - authoritative, welcoming, cutting-edge? What sensation should interactions create - smooth and liquid, snappy and precise, gentle and organic? How should the interface emotionally support the user's workflow?

### 4. Abstract References (1 paragraph)
Provide conceptual inspiration - architectural styles, cultural movements, artistic periods, premium experiences, or sophisticated environments that embody this aesthetic. Focus on the FEELING of these references, not specific brands or products.

### 5. Color Palette
Provide 6-8 colors with hex values:
- Background (main page background)
- Surface (cards, panels, elevated elements)
- Primary (main action color)
- Text (primary text)
- Text Muted (secondary, less important text)
- Accent (highlights, focus states)
- Border (dividers, outlines)
- Optional: Success, Warning, Error

### 6. Typography
- Headings: Font family, weights to use
- Body: Font family, weights to use
- Monospace: Font family (for code, data)
- Base size and scale ratio

### 7. Key Visual Characteristics
3-5 bullet points describing the most distinctive visual elements:
- Spacing approach
- Corner radius style
- Shadow/depth treatment
- Animation character
- Any unique visual signatures

---

## Style Variety Requirements

You MUST include directions from these categories to ensure diversity:

**Dark Themes (at least 2)**:
- Dark Mode First
- Monochromatic Dark
- High Contrast Dark

**Light Themes (at least 2)**:
- Swiss/International
- Scandinavian
- Editorial Light

**Bold/Distinctive (at least 2)**:
- Neobrutalist
- Bauhaus
- Tech Forward

**Sophisticated (at least 2)**:
- Glassmorphism
- Luxury Minimal
- Corporate Professional

**Approachable (at least 2)**:
- Material
- Soft UI / Neumorphic
- Warm Minimal

---

## Output Format

For each of the 12 directions, use this exact structure:

---

## Direction [N]: [Style Name]

**Emotional Concept**:
[paragraph]

**Visual Philosophy**:
[paragraph]

**Abstract References**:
[paragraph]

**Color Palette**:
| Role | Hex | Notes |
|------|-----|-------|
| Background | #... | ... |
| Surface | #... | ... |
| Primary | #... | ... |
| Text | #... | ... |
| Text Muted | #... | ... |
| Accent | #... | ... |
| Border | #... | ... |

**Typography**:
- Headings: [Font], [weights]
- Body: [Font], [weights]
- Mono: [Font]
- Scale: [base]px, ratio [1.x]

**Key Visual Characteristics**:
- [characteristic 1]
- [characteristic 2]
- [characteristic 3]
- [characteristic 4]

---

Generate all 12 directions now. Remember: each should feel distinctly different. A user should be able to glance at the color palette and typography and immediately know which direction is which.
```

---

## Usage

### Direct (Claude generates)

```bash
# Claude reads PRD/UX, fills in context, generates directions
cat artifacts/01-prd.md | head -100
cat artifacts/02-ux.md | head -100

# Then generates 12 directions inline
```

### Via Oracle (GPT-5.2 generates)

```bash
# Save filled prompt to file
cat > /tmp/design-prompt.txt << 'EOF'
[filled prompt here]
EOF

# Run through Oracle
./scripts/oracle_browser_run.sh "$(cat /tmp/design-prompt.txt)"
```

### Via Browser (Interactive)

```bash
# Open ChatGPT/Claude web and paste prompt
agent-browser open "https://chat.openai.com"
# Paste prompt, get response, use to generate HTML variants
```

---

## After Generation

Once you have the 12 written directions, generate actual HTML prototypes for each:

```bash
mkdir -p artifacts/05-design/variants

# For each direction, create:
# artifacts/05-design/variants/01-[style-name].html
# artifacts/05-design/variants/02-[style-name].html
# ... etc

# Then build manifest
node scripts/design_manifest_build.js
```

### ⚠️ REMINDER: ALL HTML FILES SHOW THE SAME SCREEN

When generating HTML, you create 12 files that ALL show:
- The SAME primary screen layout
- The SAME realistic content
- The SAME UI components

Only the VISUAL STYLE differs (colors, typography, spacing, borders, shadows).

**Example for SQLite Editor:**

All 12 HTML files should show:
```
┌─────────────────────────────────────────────────────────────┐
│ Toolbar: [SQLite Editor] [Open Database] [New Database]    │
├──────────────┬──────────────────────────────────────────────┤
│ Sidebar      │ Data Grid                                    │
│              │                                              │
│ ▼ chinook    │ albums table                                 │
│   ▼ TABLES   │ ┌────┬────────────────────┬──────────────┐  │
│     albums   │ │ ID │ Title              │ ArtistId     │  │
│     artists  │ ├────┼────────────────────┼──────────────┤  │
│     tracks   │ │ 1  │ For Those About... │ 1            │  │
│   ► VIEWS    │ │ 2  │ Balls to the Wall  │ 2            │  │
│              │ │ 3  │ Restless and Wild  │ 2            │  │
│              │ └────┴────────────────────┴──────────────┘  │
├──────────────┴──────────────────────────────────────────────┤
│ Status: Saved • OPFS • 1.2 MB • FK: ON • SQLite 3.45.0     │
└─────────────────────────────────────────────────────────────┘
```

What changes between files:
- 01-swiss.html: Light bg, Helvetica, strong grid lines, minimal decoration
- 02-dark-mode.html: #0a0a0a bg, high contrast text, subtle borders
- 03-neobrutalist.html: Thick black borders, bold colors, chunky spacing
- 04-glassmorphism.html: Translucent panels, blur effects, depth
- etc.

**DO NOT create variants showing different screens (ERD, Designer, Welcome).**
