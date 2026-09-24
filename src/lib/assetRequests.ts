import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';

// Approve/reject for emp_asset_request. Reject is a status flip only. Approve does the same
// work POST /api/employees/assets does (src/app/api/employees/assets/route.ts) — inserts an
// asset_allocate row and flips asset_management.status to 'Allocated' — inside one transaction,
// so approving a request IS allocating the asset, not a separate step the admin does afterward.
export interface DecideResult {
  ok: boolean;
  error?: string;
}

export interface ApproveDetails {
  assetState?: string;
  description?: string;
  officialMail?: string;
  officialContact?: string;
  crmId?: string;
  allocatedOfcSpace?: string;
}

export async function decideAssetRequest(
  pool: Pool,
  id: number,
  decision: 'approve' | 'reject',
  remarks: string | undefined,
  loginUserId: string,
  approveDetails?: ApproveDetails
): Promise<DecideResult> {
  const [[req]] = await pool.execute<RowDataPacket[]>(
    'SELECT request_pkey, emp_fkey, asset_pkey, reason, status FROM emp_asset_request WHERE request_pkey = ? AND active = 1',
    [id]
  );
  if (!req) return { ok: false, error: 'Asset request not found' };
  if (req.status !== 'Pending') {
    return { ok: false, error: 'This request has already been processed' };
  }

  if (decision === 'reject') {
    const finalRemarks = remarks ?? 'Rejected by Admin';
    await pool.execute(
      `UPDATE emp_asset_request SET status = 'Rejected', remarks = ?, decided_by = ?, decided_date = NOW() WHERE request_pkey = ?`,
      [finalRemarks, loginUserId, id]
    );
    return { ok: true };
  }

  // Approve — allocate the actual asset.
  if (!req.asset_pkey) {
    return { ok: false, error: 'No specific asset was selected for this request' };
  }

  const [[asset]] = await pool.execute<RowDataPacket[]>(
    'SELECT asset_pkey, name, model, brand, serial_no, warranty, status FROM asset_management WHERE asset_pkey = ?',
    [req.asset_pkey]
  );
  if (!asset) return { ok: false, error: 'The requested asset no longer exists in the catalog' };
  if (asset.status === 'Allocated') {
    return { ok: false, error: 'This asset has already been allocated to someone else' };
  }

  const finalRemarks = remarks ?? 'Approved by Admin';
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    await connection.execute<ResultSetHeader>(
      `INSERT INTO asset_allocate
         (emp_fkey, asset, qty, model, asset_name, brand, s_no, warranty, allocated_date,
          pemp_fkey, status, damaged_amout, description, official_mail, official_contact,
          crm_id, allocated_ofc_space, asset_state, active)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, CURDATE(), 0, 'Allocated', '', ?, ?, ?, ?, ?, ?, '1')`,
      [
        req.emp_fkey, asset.asset_pkey, asset.model ?? '', asset.name, asset.brand ?? '',
        asset.serial_no ?? '', asset.warranty ?? '', approveDetails?.description ?? req.reason ?? '',
        approveDetails?.officialMail ?? '', approveDetails?.officialContact ?? '',
        approveDetails?.crmId ?? '', approveDetails?.allocatedOfcSpace ?? '',
        approveDetails?.assetState ? Number(approveDetails.assetState) : 1,
      ]
    );

    await connection.execute(
      `UPDATE asset_management SET status = 'Allocated' WHERE asset_pkey = ?`,
      [asset.asset_pkey]
    );

    await connection.execute(
      `UPDATE emp_asset_request SET status = 'Approved', remarks = ?, decided_by = ?, decided_date = NOW() WHERE request_pkey = ?`,
      [finalRemarks, loginUserId, id]
    );

    await connection.commit();
    return { ok: true };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
