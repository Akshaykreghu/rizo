'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SetupCrudPage } from '@/components/setup/SetupCrudPage';

interface Branch {
  branch_code: string;
  branch_name: string;
}

interface HolidayGroup {
  HOLIDAY_GROUP_ID: number;
  HOLIDAY_GROUP_NAME: string;
}

export default function HolidaysPage() {
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);

  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['setup/branches'],
    queryFn: () => fetch('/api/setup/branches').then((r) => r.json()),
  });

  const { data: groups = [] } = useQuery<HolidayGroup[]>({
    queryKey: ['setup/holiday-groups'],
    queryFn: () => fetch('/api/setup/holiday-groups').then((r) => r.json()),
  });

  const activeGroupId = selectedGroupId ?? groups[0]?.HOLIDAY_GROUP_ID ?? null;

  return (
    <div className="space-y-10">
      <div>
        <SetupCrudPage
          title="Holiday Groups"
          apiPath="setup/holiday-groups"
          primaryKey="HOLIDAY_GROUP_ID"
          displayKey="HOLIDAY_GROUP_NAME"
          fields={[
            { key: 'HOLIDAY_GROUP_NAME', label: 'Group Name', required: true },
            {
              key: 'BRANCH_CODE',
              label: 'Branch',
              type: 'select',
              options: branches.map((b) => ({ value: b.branch_code, label: b.branch_name })),
            },
          ]}
          columns={[
            { key: 'HOLIDAY_GROUP_NAME', label: 'Group Name' },
            { key: 'BRANCH_CODE', label: 'Branch' },
          ]}
        />
      </div>

      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Holidays</h2>
        {groups.length === 0 ? (
          <p className="text-sm text-gray-500">Create a Holiday Group first.</p>
        ) : (
          <>
            <div className="mb-4 max-w-xs">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Holiday Group
              </label>
              <select
                value={activeGroupId ?? ''}
                onChange={(e) => setSelectedGroupId(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {groups.map((g) => (
                  <option key={g.HOLIDAY_GROUP_ID} value={g.HOLIDAY_GROUP_ID}>
                    {g.HOLIDAY_GROUP_NAME}
                  </option>
                ))}
              </select>
            </div>

            {activeGroupId && (
              <SetupCrudPage
                title="Holidays"
                apiPath="setup/holidays"
                queryParams={{ groupId: String(activeGroupId) }}
                primaryKey="HOLIDAYID"
                displayKey="HOLIDAYNAME"
                fields={[
                  { key: 'HOLIDAYNAME', label: 'Holiday Name', required: true },
                  { key: 'HOLIDAYDATE', label: 'Date', type: 'date', required: true },
                  { key: 'DESCRIPTION', label: 'Description', required: true },
                ]}
                columns={[
                  { key: 'HOLIDAYNAME', label: 'Name' },
                  { key: 'HOLIDAYDATE', label: 'Date' },
                  { key: 'DESCRIPTION', label: 'Description' },
                ]}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
