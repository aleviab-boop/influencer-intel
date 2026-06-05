import { FeaturePage, MockDoc, MockTable, MockStats } from '@/components/feature-page';

export default function Page() {
  return (
    <FeaturePage
      ctaHref="/payouts"
      hero={{
        title: 'Contracts and payouts in one place',
        subtitle: 'Agree rates, generate agreements, and pay creators — milestone or per-deliverable — without leaving the platform.',
        mock: (
          <MockDoc
            title="Collaboration agreement · Aisha Kapoor"
            rows={[
              ['Deliverables', '2 reels + 3 stories'],
              ['Rate', '₹85,000'],
              ['Timeline', '14 days'],
              ['Payout', 'On delivery'],
            ]}
          />
        ),
      }}
      sections={[
        {
          title: 'Digital Contracts',
          bullets: [
            'Generate agreements from agreed deliverables and rates.',
            'E-sign in-app — no email back-and-forth.',
            'Standardize terms across every creator.',
            'Keep all contracts auditable in one place.',
          ],
          mock: (
            <MockDoc
              title="Agreement · Rohan Mehta"
              rows={[
                ['Deliverables', '1 reel + 1 post'],
                ['Rate', '₹1,20,000'],
                ['Usage rights', '90 days'],
                ['Payout', '50% upfront'],
              ]}
            />
          ),
        },
        {
          title: 'Automated Payouts',
          bullets: [
            'Pay creators on milestones or per deliverable.',
            'Trigger payouts automatically when work is approved.',
            'Support multiple payout methods.',
            'Handle TDS/GST and generate receipts.',
          ],
          mock: (
            <MockTable
              cols={['Creator', 'Amount', 'Status']}
              rows={[
                ['Aisha Kapoor', '₹85,000', 'Paid'],
                ['Rohan Mehta', '₹60,000', 'Scheduled'],
                ['Neha Sharma', '₹40,000', 'Pending'],
                ['Arjun Rao', '₹2,10,000', 'Paid'],
              ]}
            />
          ),
        },
        {
          title: 'Payment Tracking',
          bullets: [
            'Track every payout and its status from one dashboard.',
            'Reconcile spend against campaign budgets.',
            'Export statements for finance.',
            'Never miss a creator payment again.',
          ],
          mock: <MockStats items={[['Paid this month', '₹18.4L'], ['Scheduled', '₹3.2L'], ['Creators paid', '142'], ['Avg payout', '₹62k']]} />,
        },
      ]}
      faqs={[
        { q: 'How are contracts created?', a: 'Generate an agreement from the agreed deliverables and rate, then e-sign in-app.' },
        { q: 'What payout models are supported?', a: 'Milestone-based or per-deliverable, triggered automatically when work is approved.' },
        { q: 'Do you handle tax and receipts?', a: 'TDS/GST handling and receipt generation are built into the payout flow.' },
      ]}
    />
  );
}
