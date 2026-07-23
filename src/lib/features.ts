import mysql from 'mysql2/promise';
import { controlPool } from './db';

// Gating key is `feature_path` (e.g. "EmployeeLoan/ctcupload"), not `feature_key` —
// feature_key is a shared display category (many features share "Payroll", "Employee", etc.),
// confirmed live against the real `features`/`plan_features` tables (control DB).
// `plan_features` (plural) is the real join table; a `plan_feature` (singular) table does not exist.

export async function isPlanFeatureEnabled(
  planId: number | null | undefined,
  featurePath: string
): Promise<boolean> {
  if (!planId) return false;
  const [rows] = await controlPool.execute<mysql.RowDataPacket[]>(
    `SELECT pf.is_enabled
     FROM plan_features pf
     JOIN features f ON pf.feature_id = f.feature_id
     WHERE pf.plan_id = ? AND f.feature_path = ? AND pf.is_enabled = 1`,
    [planId, featurePath]
  );
  return rows.length > 0;
}

// Returns the set of feature_paths enabled for a plan, e.g. { "EmployeeLoan/ctcupload": true, ... }
export async function getPlanFeatures(
  planId: number | null | undefined
): Promise<Record<string, boolean>> {
  if (!planId) return {};
  const [rows] = await controlPool.execute<mysql.RowDataPacket[]>(
    `SELECT f.feature_path, pf.is_enabled
     FROM plan_features pf
     JOIN features f ON pf.feature_id = f.feature_id
     WHERE pf.plan_id = ?`,
    [planId]
  );
  return Object.fromEntries(
    rows
      .filter((r) => r.feature_path)
      .map((r) => [r.feature_path as string, Boolean(r.is_enabled)])
  );
}

// Feature catalog grouped by category (feature_key), for building tile/landing-page UIs
// that need to show a feature's name/icon/description, not just a boolean.
export interface CatalogFeature {
  feature_id: number;
  feature_key: string;
  feature_name: string;
  feature_path: string | null;
  icon: string | null;
}

export async function getPlanFeatureCatalog(
  planId: number | null | undefined
): Promise<CatalogFeature[]> {
  if (!planId) return [];
  const [rows] = await controlPool.execute<mysql.RowDataPacket[]>(
    `SELECT f.feature_id, f.feature_key, f.feature_name, f.feature_path, f.icon
     FROM plan_features pf
     JOIN features f ON pf.feature_id = f.feature_id
     WHERE pf.plan_id = ? AND pf.is_enabled = 1
     ORDER BY f.feature_key, f.display_order`,
    [planId]
  );
  return rows as unknown as CatalogFeature[];
}
