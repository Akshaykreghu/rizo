import { SetupCrudPage } from '@/components/setup/SetupCrudPage';

export default function ContactsPage() {
  return (
    <SetupCrudPage
      title="Contacts"
      apiPath="setup/contacts"
      primaryKey="contact_id"
      displayKey="company_name"
      fields={[
        { key: 'company_name', label: 'Company Name', required: true },
        { key: 'relationship', label: 'Relationship', required: true, type: 'select', options: [
          { value: 'Vendor', label: 'Vendor' },
          { value: 'Customer', label: 'Customer' },
          { value: 'Others', label: 'Others' },
        ] },
        { key: 'first_name', label: 'Contact First Name', required: true },
        { key: 'last_name', label: 'Contact Last Name', required: true },
        { key: 'c_designation', label: 'Designation' },
        { key: 'email', label: 'Email', required: true },
        { key: 'phone', label: 'Phone', required: true },
        { key: 'address', label: 'Address', required: true },
        { key: 'city', label: 'City', required: true },
        { key: 'state', label: 'State', required: true },
        { key: 'pincode', label: 'Pincode', required: true },
        { key: 'reg', label: 'Registration No.' },
        { key: 'pan_no', label: 'PAN No.', required: true },
        { key: 'gst', label: 'GST No.', required: true },
        { key: 'tin', label: 'TAN' },
        { key: 'bank_name', label: 'Bank Name', required: true },
        { key: 'bank_branch', label: 'Bank Branch', required: true },
        { key: 'ifsc_code', label: 'IFSC Code', required: true },
        { key: 'account_no', label: 'Account No.', required: true },
      ]}
      columns={[
        { key: 'company_name', label: 'Company' },
        { key: 'relationship', label: 'Relationship' },
        { key: 'first_name', label: 'Contact Person' },
        { key: 'phone', label: 'Phone' },
        { key: 'city', label: 'City' },
      ]}
    />
  );
}
