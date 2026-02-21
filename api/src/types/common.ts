// ─── Common utility types ───────────────────────────────────────────────────
/** Unix timestamp in seconds */
export type UnixTimestamp = number;

/** Database boolean: 0 or 1 */
export type DbBoolean = 0 | 1;

/** Player realm */
export type Realm = 'syrtis' | 'alsius' | 'ignis';

/** Optional realm (players may not have one yet) */
export type RealmOrNull = Realm | null;

/** mysql2 RowDataPacket compatible - allows generic result typing */
export type DbRow<T> = T & import('mysql2').RowDataPacket;
