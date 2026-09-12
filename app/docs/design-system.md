# JL Golf Sales — Design System

This document defines the visual design rules for the JL Golf Sales application.
Use this as the reference when creating or modifying UI components.

## Color Palette

### Primary — Forest
**Variable:** `--primary` / `--forest`  
**Hex:** `#12372A`

Use for:
- Primary buttons
- Important interactive elements
- Brand elements
- Active states
- Major navigation emphasis

Example:
`bg-primary text-white`

Avoid using Forest for large amounts of body text.

---

### Primary Hover — Fairway Green
**Variable:** `--primary-hover` / `--fairway`  
**Hex:** `#3A6B4A`

Use for:
- Primary button hover states
- Secondary green accents
- Interactive states
- Charts when another green tone is needed

Example:
`hover:bg-primary-hover`

---

### Accent — Gold
**Variable:** `--accent` / `--gold`  
**Hex:** `#C6A15B`

Use sparingly.

Use for:
- Important KPIs
- Selected navigation indicators
- Premium features
- Small icons
- Badges
- Important highlights

Example:
`text-accent`

Gold should NOT be used as a primary page or card background.
Its purpose is to create visual emphasis.

---

### Charcoal
**Variable:** `--charcoal` / `--foreground`  
**Hex:** `#171A1D`

Use for:
- Primary text
- Headings
- Dark navigation
- Sidebar background
- High-contrast UI elements

Example:
`text-foreground`

---

### Warm White
**Variable:** `--warm-white` / `--background`  
**Hex:** `#F8F7F3`

Use for:
- Main application background
- Large neutral areas

Example:
`bg-background`

---

### White
**Variable:** `--card`  
**Hex:** `#FFFFFF`

Use for:
- Cards
- Tables
- Modals
- Dropdowns
- Elevated surfaces

Example:
`bg-card`

---

### Cool Gray
**Variable:** `--cool-gray` / `--border`  
**Hex:** `#E8EAEB`

Use for:
- Borders
- Dividers
- Disabled backgrounds
- Subtle UI separation

Example:
`border-border`

---

### Slate
**Variable:** `--slate` / `--muted-foreground`  
**Hex:** `#66706B`

Use for:
- Secondary text
- Descriptions
- Metadata
- Table supporting information
- Form helper text

Example:
`text-muted-foreground`

---

# General UI Rules

## Page Structure

Main page:
`bg-background text-foreground`

Cards:
`bg-card border border-border`

Primary button:
`bg-primary text-white hover:bg-primary-hover`

Secondary text:
`text-muted-foreground`

Premium / important highlight:
`text-accent`

## Color Hierarchy

The interface should primarily consist of:

1. Warm White / White — surfaces
2. Charcoal — text and navigation
3. Forest — primary actions and branding
4. Fairway — interaction states
5. Gold — selective emphasis

## Gold Rule

Gold is an accent, not a primary color.

If many elements on the screen are gold, too much gold is being used.

## Design Goal

The JL Golf Sales interface should feel:

- Premium
- Professional
- Modern
- Golf-oriented
- Clean
- Data-focused

Avoid making the application look like a golf course website.
This is a professional sales application for the golf industry.