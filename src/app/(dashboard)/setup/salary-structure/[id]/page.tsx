import { SalaryStructureForm } from '@/components/setup/SalaryStructureForm';

export default async function EditSalaryStructurePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SalaryStructureForm structureId={Number(id)} />;
}
