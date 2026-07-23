import { ShiftForm } from '@/components/setup/ShiftForm';

export default async function EditShiftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ShiftForm id={id} />;
}
