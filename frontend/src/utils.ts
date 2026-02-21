/**
 * Shared utility functions.
 */

/** Simple HTML entity escaper for safe DOM insertion. */
export function escapeHtml(str: string | null | undefined): string {
  if (str === null || typeof str === 'undefined') return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Format a duration in seconds to a human-readable string like "1h 5m 30s". */
export function formatDurationSeconds(s: number): string {
  if (typeof s !== 'number' || isNaN(s)) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  let out = '';
  if (h) out += h + 'h ';
  if (m) out += m + 'm ';
  out += sec + 's';
  return out;
}

/**
 * Extract a human-readable error message from various error shapes.
 * Handles { body: { error } }, { message }, and plain strings.
 */
export function getErrorMessage(err: any, fallback: string = 'An error occurred'): string {
  if (!err) return fallback;
  if (err.body && err.body.error) return err.body.error;
  if (err.message) return err.message;
  if (typeof err === 'string') return err;
  return fallback;
}
