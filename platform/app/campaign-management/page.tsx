import { FeaturePage, MockBoard, MockTable, MockStats } from '@/components/feature-page';

export default function Page() {
  return (
    <FeaturePage
      ctaHref="/campaigns"
      hero={{
        title: 'Run influencer campaigns end-to-end',
        subtitle: 'Automate outreach, approvals and recruitment — manage every creator and campaign from one place.',
        mock: (
          <MockBoard columns={[
            { title: 'Invited', items: ['Aisha K.', 'Rohan M.'] },
            { title: 'Contacted', items: ['Neha S.'] },
            { title: 'Recruited', items: ['Arjun R.', 'Bhumika'] },
            { title: 'Declined', items: ['Vikram T.'] },
          ]} />
        ),
      }}
      sections={[
        {
          title: 'Recruitment Pipeline',
          bullets: [
            'Recruit creators into named programs in one click from discovery.',
            'Move every creator through invited → contacted → recruited → declined.',
            'See live counts per stage so nothing stalls.',
            'Run multiple campaigns in parallel without losing track.',
          ],
          mock: (
            <MockBoard columns={[
              { title: 'Invited', items: ['Aisha K.', 'Sara D.'] },
              { title: 'Contacted', items: ['Neha S.', 'Dev P.'] },
              { title: 'Recruited', items: ['Arjun R.'] },
              { title: 'Declined', items: ['Vikram T.'] },
            ]} />
          ),
        },
        {
          title: 'Automated Outreach & Approvals',
          bullets: [
            'Generate personalized outreach for each creator automatically.',
            'Approve or counter-offer rates inside the platform.',
            'Trigger reminders so no conversation goes cold.',
            'Keep the whole team aligned on campaign status.',
          ],
          mock: (
            <MockTable
              cols={['Creator', 'Stage', 'Rate', 'Status']}
              rows={[
                ['Aisha Kapoor', 'Contacted', '₹85k', 'Pending'],
                ['Rohan Mehta', 'Recruited', '₹1.2L', 'Accepted'],
                ['Neha Sharma', 'Invited', '₹40k', 'Sent'],
                ['Arjun Rao', 'Recruited', '₹2.1L', 'Accepted'],
              ]}
            />
          ),
        },
        {
          title: 'Deliverables & Performance',
          bullets: [
            'Track deliverables, due dates and live status per creator.',
            'Roll campaign metrics up into one view.',
            'Spot under-performing slots early and reallocate budget.',
            'Export campaign reports for stakeholders in a click.',
          ],
          mock: <MockStats items={[['Programs', '6'], ['Recruited', '48'], ['Live deliverables', '23'], ['Avg ER', '4.1%']]} />,
        },
      ]}
      faqs={[
        { q: 'How do I start a campaign?', a: 'Create a program, then recruit creators into it straight from discovery — they enter the pipeline automatically.' },
        { q: 'Can I manage many campaigns at once?', a: 'Yes — run unlimited programs in parallel, each with its own pipeline and metrics.' },
        { q: 'Does it handle outreach?', a: 'Personalized outreach is generated per creator, with approvals and counter-offers handled in-app.' },
      ]}
    />
  );
}
