import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { CriteriaRequiredError } from '@/lib/reports';
import { generateEpfReport, generateEsiReport, generateProfTaxReport, generateWageSheetReport, generateMusterRollReport } from '@/lib/statutoryReports';
import { NextRequest, NextResponse } from 'next/server';

const TYPES = ['EPF', 'ESI', 'ProfTax', 'wage', 'Musterroll'] as const;

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const type = TYPES.includes(body.type) ? body.type : 'EPF';
  const criteria = body.criteria ?? {};
  const pool = await getCompanyPool(session.user.companyCode);

  try {
    let rows;
    if (type === 'ProfTax') {
      if (!body.fromMonth || !body.toMonth) return NextResponse.json({ error: 'fromMonth and toMonth are required' }, { status: 400 });
      rows = await generateProfTaxReport(pool, { fromMonth: body.fromMonth, toMonth: body.toMonth, criteria });
    } else {
      if (!body.monthYear) return NextResponse.json({ error: 'monthYear is required' }, { status: 400 });
      if (type === 'ESI') rows = await generateEsiReport(pool, { monthYear: body.monthYear, criteria });
      else if (type === 'wage') rows = await generateWageSheetReport(pool, { monthYear: body.monthYear, criteria });
      else if (type === 'Musterroll') rows = await generateMusterRollReport(pool, { monthYear: body.monthYear, includeResigned: !!body.includeResigned, criteria });
      else rows = await generateEpfReport(pool, { monthYear: body.monthYear, criteria });
    }
    return NextResponse.json({ rows });
  } catch (err) {
    if (err instanceof CriteriaRequiredError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
