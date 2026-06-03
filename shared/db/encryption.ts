// ============================================================
// Boltic encryption SQL helpers.
//
// Boltic Database enforces column-level encryption. Plain text
// inserts into encrypted columns silently fail. To write or read
// these values you must wrap them with the SQL helpers:
//
//   boltic_encrypt(value)              — encrypt (one-way)
//   boltic_encrypt_searchable(value)   — encrypt with deterministic
//                                         output so equality lookups work
//   boltic_decrypt(value)              — decrypt on read
//
// Columns we currently encrypt:
//   - service_accounts.storage_state     (large JSONB; one-way encrypt)
//   - creators.verified_oauth_data       (JSONB; one-way encrypt)
//   - brands.users (OAuth tokens within) (JSONB array; encrypt the
//     `gmail_oauth_token` and `ig_oauth_token` strings before
//     putting them into the JSONB)
//
// Use these helpers when constructing INSERT/UPDATE statements that
// touch encrypted columns; use selectDecrypted() when reading them.
// ============================================================

/**
 * Wrap a parameter expression with boltic_encrypt() for one-way encryption.
 * Returns the SQL fragment to embed in a query.
 *   const sql = `INSERT INTO t (col) VALUES (${enc('$1')})`;
 */
export function enc(paramExpr: string): string {
  return `boltic_encrypt(${paramExpr})`;
}

/**
 * Searchable encryption — deterministic output, supports equality lookups
 * (e.g. WHERE col = boltic_encrypt_searchable($1)).
 */
export function encSearchable(paramExpr: string): string {
  return `boltic_encrypt_searchable(${paramExpr})`;
}

/**
 * Decrypt a column on read.
 *   SELECT ${dec('storage_state')} AS storage_state FROM service_accounts
 */
export function dec(columnExpr: string): string {
  return `boltic_decrypt(${columnExpr})`;
}

/**
 * Builds a SELECT clause that decrypts a list of columns by name.
 * Returns: "boltic_decrypt(col1) AS col1, boltic_decrypt(col2) AS col2, ..."
 */
export function decryptedSelect(columns: string[]): string {
  return columns.map((c) => `${dec(`"${c}"`)} AS "${c}"`).join(', ');
}
