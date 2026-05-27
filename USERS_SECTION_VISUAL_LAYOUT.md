# Users Section - Visual Layout Preview

## Desktop View (≥601px)

```
┌─────────────────────────────────────────┐
│ Users                               [4] │ ← Section title with count pill
│                                         │
│ ↕ 20px spacing                          │
│                                         │
│ 👑 FACILITATOR                          │ ← Group header (14px, blue, bold, uppercase)
│   CHARLIE              ✔ Selected       │ ← Facilitator name (indented 20px)
│                                         │
│ 👤 VOTERS                               │ ← Group header (14px, blue, bold, uppercase)
│   ALICE                ✔ Selected       │ ← Voter names (indented 20px)
│   BOB                  —                │ ← Sorted alphabetically
│   DAVID                —                │
└─────────────────────────────────────────┘
```

## Mobile View (≤600px)

```
┌───────────────────────────┐
│ Users                 [4] │ ← Section title
│                           │
│ ↕ 16px spacing            │
│                           │
│ 👑 FACILITATOR            │ ← Group header (13px, blue)
│   CHARLIE    ✔ Selected   │ ← Indented 16px
│                           │
│ 👤 VOTERS                 │ ← Group header (13px, blue)
│   ALICE      ✔ Selected   │ ← Indented 16px
│   BOB        —            │
│   DAVID      —            │
└───────────────────────────┘
```

## Detailed Breakdown

### Section Header
- **"Users"** title with count pill **[4]**
- Font: 16px, bold
- Color: White

### 20px Spacing
- Consistent with Story and Vote sections
- Creates breathing room after title

### Group Headers (👑 FACILITATOR / 👤 VOTERS)
- **Emoji**: 18px (desktop), 16px (mobile)
- **Label**: 14px (desktop), 13px (mobile)
- **Style**: Bold (700), Uppercase, Blue accent color
- **Letter-spacing**: 0.06em
- **Same styling as "ADD A STORY" and "CAST YOUR VOTE"**

### User Names
- **Indented**: 20px (desktop), 16px (mobile)
- **Font**: 15px (desktop), 14px (mobile)
- **Style**: Bold (700), Uppercase
- **Color**: White
- **Vote Status**: Right-aligned, 14px (desktop), 13px (mobile)

## Spacing Details

### Desktop
```
Users                               [4]
↕ 20px (list padding-top)
👑 FACILITATOR
↕ 0px (no extra spacing)
  CHARLIE              ✔ Selected
↕ 8px (margin between groups)
👤 VOTERS
↕ 0px (no extra spacing)
  ALICE                ✔ Selected
  BOB                  —
  DAVID                —
```

### Key Measurements (Desktop)
- Section title → First group header: **20px**
- Group header padding: 16px top, 8px bottom
- User item padding: 12px vertical
- User item indent: 20px left
- Gap between groups: 8px margin-top

### Key Measurements (Mobile)
- Section title → First group header: **16px** (via mobile override)
- Group header padding: 12px top, 6px bottom
- User item padding: 10px vertical
- User item indent: 16px left
- Gap between groups: 6px margin-top

## Color Scheme

- **Section Title**: White (`var(--text)`)
- **Group Headers**: Blue accent (`var(--accent)` = #7aa2ff)
- **User Names**: White (`var(--text)`)
- **Vote Status**: Muted gray (`var(--muted)`)
- **Facilitator Background**: Subtle blue highlight (rgba(122,162,255,.05))

## Comparison with Other Sections

### Story Section
```
Story                           [pill]
↕ 20px
ADD A STORY                     ← Blue, 14px, bold, uppercase
```

### Vote Section
```
Vote                            [pill]
↕ 20px
CAST YOUR VOTE                  ← Blue, 14px, bold, uppercase
```

### Users Section
```
Users                           [pill]
↕ 20px
👑 FACILITATOR                  ← Blue, 14px, bold, uppercase
  CHARLIE         ✔ Selected
↕ 8px
👤 VOTERS                       ← Blue, 14px, bold, uppercase
  ALICE           ✔ Selected
  BOB             —
```

## Visual Consistency ✅

All three sections now have:
- ✅ **Same spacing**: 20px from title to first header
- ✅ **Same header style**: Blue, 14px, bold, uppercase
- ✅ **Same letter-spacing**: 0.06em
- ✅ **Consistent visual rhythm**

## Example with Multiple Facilitators

```
Users                               [5]
↕ 20px
👑 FACILITATOR
  ALICE                ✔ Selected
  CHARLIE              ✔ Selected
↕ 8px
👤 VOTERS
  BOB                  —
  DAVID                —
  EMMA                 ✔ Selected
```

## Example with Only Facilitator

```
Users                               [1]
↕ 20px
👑 FACILITATOR
  CHARLIE              ✔ Selected
```

## Example with Only Voters

```
Users                               [3]
↕ 20px
👤 VOTERS
  ALICE                ✔ Selected
  BOB                  —
  DAVID                —
```
