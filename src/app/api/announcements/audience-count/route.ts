import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { AUDIENCE_TYPES, countAudience, type AudienceType } from '@/lib/announcements';

// Live "reaches N employees" preview for the admin announcement form.
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const audienceType = String(body.audienceType ?? '') as AudienceType;
  if (!AUDIENCE_TYPES.includes(audienceType)) {
    return NextResponse.json({ error: 'Invalid audience' }, { status: 400 });
  }
  const targets = Array.isArray(body.targets) ? body.targets.map(String).filter(Boolean) : [];

  const pool = await getCompanyPool(session.user.companyCode);
  return NextResponse.json({ count: await countAudience(pool, audienceType, targets) });
}
