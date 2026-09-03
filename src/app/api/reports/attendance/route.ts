import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { CriteriaRequiredError } from '@/lib/reports';
import {
  generateAttendanceRegisterReport,
  generateDetailedAttendanceReport,
  generateOvertimeDetailReport,
  generateApprovedOvertimeReport,
  generateCheckinLogsReport,
  generateRegularisationReport,
  generateNonPunchedReport,
} from '@/lib/attendanceReports';
import { NextRequest, NextResponse } from 'next/server';

const TYPES = ['VerifiedAttendance', 'DetailedAttendance', 'OvertimeReport', 'Overtime', 'Dashboard', 'regularisation', 'NonPunched'] as const;

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const type = TYPES.includes(body.type) ? body.type : 'VerifiedAttendance';
  const criteria = body.criteria ?? {};
  const pool = await getCompanyPool(session.user.companyCode);

  try {
    let rows;
    switch (type) {
      case 'DetailedAttendance':
        if (!body.monthYear) return NextResponse.json({ error: 'monthYear is required' }, { status: 400 });
        rows = await generateDetailedAttendanceReport(pool, { monthYear: body.monthYear, criteria });
        break;
      case 'OvertimeReport':
        if (!body.monthYear) return NextResponse.json({ error: 'monthYear is required' }, { status: 400 });
        rows = await generateOvertimeDetailReport(pool, { monthYear: body.monthYear, criteria });
        break;
      case 'Overtime':
        if (!body.monthYear) return NextResponse.json({ error: 'monthYear is required' }, { status: 400 });
        rows = await generateApprovedOvertimeReport(pool, { monthYear: body.monthYear, criteria });
        break;
      case 'Dashboard':
        if (!body.fromDate || !body.toDate) return NextResponse.json({ error: 'fromDate and toDate are required' }, { status: 400 });
        rows = await generateCheckinLogsReport(pool, { fromDate: body.fromDate, toDate: body.toDate, criteria });
        break;
      case 'regularisation':
        if (!body.fromDate || !body.toDate) return NextResponse.json({ error: 'fromDate and toDate are required' }, { status: 400 });
        rows = await generateRegularisationReport(pool, { fromDate: body.fromDate, toDate: body.toDate, criteria });
        break;
      case 'NonPunched':
        if (!body.fromDate || !body.toDate) return NextResponse.json({ error: 'fromDate and toDate are required' }, { status: 400 });
        rows = await generateNonPunchedReport(pool, { fromDate: body.fromDate, toDate: body.toDate, criteria });
        break;
      default:
        if (!body.monthYear) return NextResponse.json({ error: 'monthYear is required' }, { status: 400 });
        rows = await generateAttendanceRegisterReport(pool, { monthYear: body.monthYear, criteria });
    }
    return NextResponse.json({ rows });
  } catch (err) {
    if (err instanceof CriteriaRequiredError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
