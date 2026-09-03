import { redirect } from 'next/navigation';

// Only one ESS feature exists today — land straight on it. Add a real landing/menu page once
// there's more than one ESS destination to choose between.
export default function EssIndexPage() {
  redirect('/ess/regularisation');
}
