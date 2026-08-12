'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { EmployeeDetail } from '@/components/employees/EmployeeDetail';

export default function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  return <EmployeeDetail id={id} onBack={() => router.push('/employees')} />;
}
