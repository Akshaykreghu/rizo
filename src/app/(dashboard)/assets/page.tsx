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
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'Type', label: 'Type' },
        { key: 'model', label: 'Model' },
        { key: 'brand', label: 'Brand' },
        { key: 'serial_no', label: 'Serial No.' },
        { key: 'status', label: 'Status' },
      ]}
      fields={[
        { key: 'name', label: 'Asset Name', required: true },
        { key: 'Type', label: 'Type', type: 'select', options: assetTypes.map((t) => ({ value: t.asset_type_name, label: t.asset_type_name })) },
        { key: 'model', label: 'Model' },
        { key: 'brand', label: 'Brand' },
        { key: 'serial_no', label: 'Serial No.' },
        { key: 'warranty', label: 'Warranty' },
        { key: 'value', label: 'Value' },
        { key: 'year', label: 'Year' },
        { key: 'specifications', label: 'Specifications' },
      ]}
    />
  );
}
