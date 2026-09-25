import { PageSkeleton } from '@/components/ui/Skeleton';

// Shown inside the ESS shell (top nav stays put) while a page's route segment loads. ESS pages
// pad themselves, so the placeholder does too.
export default function EssLoading() {
  return (
    <div style={{ padding: '24px 28px 40px', background: 'var(--bg-page)', minHeight: '100%' }}>
      <PageSkeleton stats={4} body="split" />
    </div>
  );
}
