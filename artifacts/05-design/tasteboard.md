# Tasteboard — WASM SQLite Editor

## Design Direction: Swiss/International Style

### Core Aesthetic
- **Ultra-clean typography** — Geometric sans-serifs, sharp hierarchy
- **Grid-based systematic design** — Mathematical structure enables clarity
- **Functionalist precision** — Every element serves a purpose
- **Abundant whitespace** — Reinforces the clarity the product delivers

### Reference: PodTranscript Landing Page
![PodTranscript](reference-podtranscript.png)

**What works:**
- Bold headline with muted secondary text (gray for less important words)
- Deep navy blue for primary actions and trust
- Minimal nav, no visual noise
- Card-like product preview with subtle shadow
- Monospace status text for technical credibility
- Pill badge for announcements ("SYSTEM 2.0 AVAILABLE")

### Color Palette

| Role | Color | Usage |
|------|-------|-------|
| **Primary action** | Deep navy `#1e3a5f` | Buttons, selected states |
| **Text primary** | Near-black `#1a1a1a` | Headings, important labels |
| **Text secondary** | Gray `#6b7280` | Descriptions, muted content |
| **Background** | Off-white `#f9fafb` | Page background |
| **Surface** | White `#ffffff` | Cards, panels, inputs |
| **Border** | Light gray `#e5e7eb` | Dividers, input borders |
| **Accent** | Warm amber `#d4a853` | Highlights, icons, active states |
| **Success** | Muted green `#22c55e` | Saved states |
| **Error** | Muted red `#ef4444` | Validation errors |

### Typography

| Element | Font | Weight | Size |
|---------|------|--------|------|
| **H1 (hero)** | Inter/system sans | 700 | 48-64px |
| **H2 (section)** | Inter/system sans | 600 | 24-32px |
| **Body** | Inter/system sans | 400 | 14-16px |
| **Labels** | Inter/system sans | 500 | 12-14px |
| **Code/SQL** | JetBrains Mono/monospace | 400 | 13-14px |
| **Status text** | Monospace | 400 | 11-12px, uppercase |

### Layout Principles

1. **Three-panel workspace** — Sidebar (240px) | Main (flex) | Bottom (collapsible)
2. **8px grid** — All spacing multiples of 8 (8, 16, 24, 32, 48)
3. **Card elevation** — Subtle shadows, not drop shadows (`shadow-sm`)
4. **Dense but breathable** — Compact rows (32-40px) with adequate padding

### Interaction Patterns

- **Hover states** — Subtle background change, not color shift
- **Focus rings** — 2px navy outline, offset
- **Transitions** — 150ms ease-out, deliberate not playful
- **Loading** — Skeleton placeholders, not spinners (where possible)

### Inspirations

| Source | Take |
|--------|------|
| **Linear** | Keyboard-first, restrained color, command palette |
| **Notion** | Clean sidebar, inline editing, hover reveals |
| **Supabase Studio** | Three-panel DB layout, data grid styling |
| **VS Code** | Tree view patterns, context menus |
| **Swiss railway timetables** | Precision, grid alignment, trustworthy |

### Anti-Patterns (Avoid)

- Rounded "friendly" buttons (too playful)
- Gradient backgrounds
- Decorative illustrations
- Bouncy animations
- Colorful syntax highlighting (use muted tones)
- Card borders everywhere (use shadows sparingly)

---

## Design Principles (Derived)

1. **Systematic over decorative** — Grid alignment, consistent spacing
2. **Typography carries the design** — Size and weight create hierarchy, not color
3. **Quiet confidence** — The tool looks like it was built by engineers who care
4. **Information density done right** — Dense but scannable
5. **Desktop-first precision** — No mobile compromises in v1

---

## Final Direction

**Selected variant**: keystone.html (standard density, light theme)

**Key decisions**:
- Light theme with deep navy accents
- Standard density (32-40px row heights) — approachable, not cramped
- Swiss/International Style throughout
- Three-panel layout: sidebar (240px) | main (flex) | status bar

**Screens confirmed**:
- Welcome (variant-02) — drop zone + CTAs
- Main workspace with data grid (keystone)
- SQL editor with results (variant-03)
- ERD view (variant-04)
- Table designer (variant-05)

**Deferred**:
- Dark mode (not in v1 scope)
- Dense mode toggle (future preference)
