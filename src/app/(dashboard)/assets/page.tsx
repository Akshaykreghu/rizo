'use client';

import { useQuery } from '@tanstack/react-query';
import { SetupCrudPage } from '@/components/setup/SetupCrudPage';

interface AssetType { asset_type_pkey: number; asset_type_name: string }

export default function AssetsPage() {
  const { data: assetTypes = [] } = useQuery<AssetType[]>({
    queryKey: ['setup/asset-types'],
    queryFn: () => fetch('/api/setup/asset-types').then((r) => r.json()),
  });

  return (
    <SetupCrudPage
      title="Asset Catalog"
      apiPath="assets"
      primaryKey="asset_pkey"
      displayKey="name"
      compactForm
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'TypeName', label: 'Type' },
        { key: 'model', label: 'Model' },
        { key: 'brand', label: 'Brand' },
        { key: 'serial_no', label: 'Serial No.' },
        { key: 'status', label: 'Status' },
      ]}
      fields={[
        { key: 'Type', label: 'Asset Type', type: 'select', required: true, options: assetTypes.map((t) => ({ value: String(t.asset_type_pkey), label: t.asset_type_name })) },
        { key: 'specifications', label: 'Specification' },
        { key: 'model', label: 'Model', required: true },
        { key: 'name', label: 'Asset Name', required: true },
        { key: 'brand', label: 'Brand' },
        { key: 'serial_no', label: 'Serial No.' },
        { key: 'warranty', label: 'Warranty' },
        { key: 'value', label: 'Value', required: true },
      ]}
    />
  );
}
