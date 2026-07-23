import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { Users, UserCheck, CalendarX, Bell, Cake, Briefcase } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import type { RowDataPacket } from 'mysql2';

async function getDashboardData(companyCode: string, loginUserId: string, userGroup: number) {
  const pool = await getCompanyPool(companyCode);

  const [[empRow], [presentRow]] = await Promise.all([
    pool.execute<RowDataPacket[]>('SELECT COUNT(*) as total FROM emp_details WHERE status = 1'),
    pool.execute<RowDataPacket[]>('SELECT COUNT(*) as total FROM present_today'),
  ]);

  let pendingLeaves = 0;
  let pendingLeaveList: RowDataPacket[] = [];

  if (userGroup === 1) {
    const [leaveRows] = await pool.execute<RowDataPacket[]>(
      `SELECT l.leave_pkey, e.first_name, e.last_name,
              l.LEAVESTATUS, l.FROMDATE, l.TODATE, l.LEAVE_TYPE_CODE
       FROM leaveentries l
       LEFT JOIN emp_details e ON e.emp_pkey = l.EMP_fkey
       WHERE (l.ISAutherizedby = ? AND l.ISAutherized = '0' AND l.LEAVESTATUS IN ('Applied'))
          OR (l.APPROVEDBY = ? AND l.ISAPPROVED = '0' AND l.ISAutherized = '1' AND l.LEAVESTATUS IN ('Authorized'))
       ORDER BY l.FROMDATE DESC LIMIT 10`,
      [loginUserId, loginUserId]
    );
    pendingLeaves = leaveRows.length;
    pendingLeaveList = leaveRows;
  }

  const [eventRows] = await pool.execute<RowDataPacket[]>(`
    SELECT 'BIR' as event_type, first_name, last_name,
           DATE_FORMAT(date_of_birth,'%M %d') as event_date
    FROM emp_details
    WHERE DATE_FORMAT(date_of_birth,'%m-%d')
          BETWEEN DATE_FORMAT(CURDATE(),'%m-%d')
          AND DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 7 DAY),'%m-%d')
      AND status = 1
    UNION
    SELECT 'JOIN' as event_type, e.first_name, e.last_name,
           DATE_FORMAT(p.joining_date,'%M %d') as event_date
    FROM emp_proff p
    LEFT JOIN emp_details e ON e.emp_pkey = p.emp_fkey
    WHERE DATE_FORMAT(p.joining_date,'%m-%d')
          BETWEEN DATE_FORMAT(CURDATE(),'%m-%d')
          AND DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 7 DAY),'%m-%d')
      AND e.status = 1
    ORDER BY event_date
    LIMIT 10
  `);

  return {
    totalEmployees: empRow[0]?.total ?? 0,
    presentToday: presentRow[0]?.total ?? 0,
    pendingLeaves,
    pendingLeaveList,
    events: eventRows,
  };
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session) return null;

  let stats = { totalEmployees: 0, presentToday: 0, pendingLeaves: 0, pendingLeaveList: [] as RowDataPacket[], events: [] as RowDataPacket[] };

  try {
    stats = await getDashboardData(
      session.user.companyCode,
      session.user.loginUserId,
      session.user.userGroup
    );
  } catch {
    // DB not connected yet — show zeros rather than crashing
  }

  const cards = [
    { label: 'Total Employees', value: stats.totalEmployees, icon: Users, color: 'text-indigo-600 bg-indigo-50' },
    { label: 'Present Today', value: stats.presentToday, icon: UserCheck, color: 'text-green-600 bg-green-50' },
    { label: 'Pending Approvals', value: stats.pendingLeaves, icon: Bell, color: 'text-amber-600 bg-amber-50' },
    { label: 'Absent Today', value: Math.max(0, Number(stats.totalEmployees) - Number(stats.presentToday)), icon: CalendarX, color: 'text-red-600 bg-red-50' },
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-1">Dashboard</h1>
      <p className="text-gray-500 text-sm mb-6">
        Welcome back, {session.user.loginUserId} · {session.user.companyCode}
      </p>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map((card) => (
          <div key={card.label} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-gray-500">{card.label}</p>
              <div className={`p-2 rounded-lg ${card.color}`}>
                <card.icon className="w-4 h-4" />
              </div>
            </div>
            <p className="text-3xl font-bold text-gray-900">{stats.totalEmployees === 0 && card.label === 'Total Employees' ? '—' : card.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Pending Leave Approvals */}
        {session.user.userGroup === 1 && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Pending Leave Approvals</h2>
            {stats.pendingLeaveList.length === 0 ? (
              <p className="text-gray-400 text-sm">No pending approvals.</p>
            ) : (
              <div className="space-y-3">
                {stats.pendingLeaveList.map((leave) => (
                  <div key={leave.leave_pkey} className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {leave.first_name} {leave.last_name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {leave.LEAVE_TYPE_CODE} · {formatDate(leave.FROMDATE)} – {formatDate(leave.TODATE)}
                      </p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      leave.LEAVESTATUS === 'Applied'
                        ? 'bg-blue-50 text-blue-700'
                        : 'bg-amber-50 text-amber-700'
                    }`}>
                      {leave.LEAVESTATUS}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Upcoming Events */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Upcoming Events (7 days)</h2>
          {stats.events.length === 0 ? (
            <p className="text-gray-400 text-sm">No upcoming birthdays or work anniversaries.</p>
          ) : (
            <div className="space-y-3">
              {stats.events.map((ev, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${ev.event_type === 'BIR' ? 'bg-pink-50 text-pink-600' : 'bg-blue-50 text-blue-600'}`}>
                    {ev.event_type === 'BIR'
                      ? <Cake className="w-4 h-4" />
                      : <Briefcase className="w-4 h-4" />}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {ev.first_name} {ev.last_name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {ev.event_type === 'BIR' ? 'Birthday' : 'Work Anniversary'} · {ev.event_date}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
