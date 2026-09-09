import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import {
  listVariableUploads,
  saveVariableUpload,
  softDeleteVariableUploads,
  VariableUploadError,
} from '@/lib/variableUpload';
import { NextRequest, NextResponse } from 'next/server';

// Ports VariableController::employeelistvariable() / VariableSave() / deleteEmployees().
// admin-only (user_group 1), matching the legacy "Salary Processing" menu placement.

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const page = Math.max(1, Math.floor(Number(sp.get('page') ?? '1')) || 1);
  const rows = Math.min(200, Math.max(1, Math.floor(Number(sp.get('rows') ?? '50')) || 50));

  const pool = await getCompanyPool(session.user.companyCode);
  const result = await listVariableUploads(pool, {
    month: sp.get('month') ?? undefined,
    empFkey: sp.get('empFkey') ? Number(sp.get('empFkey')) : undefined,
    branch: sp.get('branch') ?? undefined,
    salaryHeadItemFkey: sp.get('salaryHeadItemFkey') ? Number(sp.get('salaryHeadItemFkey')) : undefined,
    limit: rows,
    offset: (page - 1) * rows,
  });
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json()) as {
    pkey?: number; empFkey?: number; salaryHeadItemFkey?: number;
    month?: string; amount?: number; remarks?: string;
  };
  if (!body.empFkey || !body.salaryHeadItemFkey || !body.month || body.amount == null) {
    return NextResponse.json(
      { error: 'empFkey, salaryHeadItemFkey, month and amount are required' },
      { status: 400 }
    );
  }

  const pool = await getCompanyPool(session.user.companyCode);
  try {
    const result = await saveVariableUpload(
      pool,
      {
        pkey: body.pkey,
        empFkey: Number(body.empFkey),
        salaryHeadItemFkey: Number(body.salaryHeadItemFkey),
        month: body.month,
        amount: Number(body.amount),
        remarks: body.remarks,
      },
      session.user.loginUserId
    );
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof VariableUploadError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json()) as { ids?: number[] };
  const ids = (body.ids ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) {
    return NextResponse.json({ error: 'ids is required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const result = await softDeleteVariableUploads(pool, ids);
  return NextResponse.json({ success: true, ...result });
}
