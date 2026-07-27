import { redirect } from 'next/navigation';

// Retired in favour of /brand-mentions, which does the same "who works with a
// brand" lookup with far wider recall (vision brand mentions + tagged collabs +
// recent-post captions) and shows the actual proof post. This single-brand page
// only ever queried /api/competitors?a= (the A/B overlap in competitors-service
// was never wired to a UI), so it's fully superseded.
export default function CompetitorAnalysisPage() {
  redirect('/brand-mentions');
}
