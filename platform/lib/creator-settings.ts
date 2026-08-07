// ============================================================
// Creator settings — the portal could look a creator up and show their profile,
// but never let them CORRECT it. Discovery-scraped rows are often stale or
// mis-tagged (wrong city, empty bio, generic category), and that same row feeds
// the media kit and brand-match. This is the first write path in the creator
// portal: a small, whitelisted editor over the display fields.
//
// This module is the PURE half — it validates and normalises an edit payload
// into exactly the columns we allow to change, with per-field errors. It never
// touches the DB (the route does the single `update`). Keeping it pure means
// the "what's editable / what's valid" rules are testable in isolation and the
// route can't accidentally write a column that isn't on the allow-list.
// ============================================================

// Only these `creators` columns are user-editable. Anything else (follower
// counts, engagement, scores, tokens) is derived/owned by the system.
export const EDITABLE_FIELDS = ['display_name', 'bio', 'primary_category', 'primary_city'] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

const LIMITS: Record<EditableField, number> = {
  display_name: 80,
  bio: 500,
  primary_category: 60,
  primary_city: 60,
};

export interface SettingsEditInput {
  display_name?: unknown;
  bio?: unknown;
  primary_category?: unknown;
  primary_city?: unknown;
}

export interface SettingsEditResult {
  ok: boolean;
  // Only the fields that were present, cleaned, and valid — ready to hand to
  // db.update as the SET clause. Empty object = nothing to change.
  set: Partial<Record<EditableField, string | null>>;
  errors: Partial<Record<EditableField, string>>;
}

// Collapse whitespace, trim; empty string becomes null (clears the field).
function clean(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s.length ? s : null;
}
// Bio keeps line breaks (they're meaningful), just trims outer whitespace and
// collapses runs of blank lines.
function cleanMultiline(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
  return s.length ? s : null;
}

/**
 * Validate + normalise an incoming edit. Fields absent from the payload are
 * left untouched (not cleared). Present fields are trimmed, length-checked and
 * either added to `set` or flagged in `errors`.
 */
export function sanitizeSettingsEdit(input: SettingsEditInput): SettingsEditResult {
  const set: SettingsEditResult['set'] = {};
  const errors: SettingsEditResult['errors'] = {};

  for (const field of EDITABLE_FIELDS) {
    if (!(field in input)) continue;
    const raw = (input as Record<string, unknown>)[field];
    const value = field === 'bio' ? cleanMultiline(raw) : clean(raw);

    if (value != null && value.length > LIMITS[field]) {
      errors[field] = `Keep this under ${LIMITS[field]} characters.`;
      continue;
    }
    set[field] = value;
  }

  return { ok: Object.keys(errors).length === 0, set, errors };
}

export const FIELD_LIMITS = LIMITS;
