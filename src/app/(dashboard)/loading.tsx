import { PageSkeleton } from '@/components/ui/Skeleton';

// Shown inside the admin shell (sidebar + header stay put) while a page's route segment loads.
export default function DashboardLoading() {
  return <PageSkeleton stats={0} body="table" />;
}
