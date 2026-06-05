import { FeaturePage, MockTable, MockBars, MockStats } from '@/components/feature-page';

export default function Page() {
  return (
    <FeaturePage
      ctaHref="/competitors"
      hero={{
        title: 'See who your competitors work with',
        subtitle: 'Track creator overlaps, share of voice, and collaborations across your niche — and out-plan the competition.',
        mock: (
          <MockTable
            cols={['Creator', 'Your brand', 'Competitor']}
            rows={[
              ['Aisha Kapoor', 'Yes', 'Yes'],
              ['Rohan Mehta', '—', 'Yes'],
              ['Neha Sharma', 'Yes', '—'],
              ['Arjun Rao', '—', 'Yes'],
            ]}
          />
        ),
      }}
      sections={[
        {
          title: 'Creator Overlap',
          bullets: [
            'See which creators already work with your competitors.',
            'Spot shared creators to defend, and exclusive ones to win.',
            'Filter overlaps by category, tier and region.',
            'Build target lists from competitor rosters instantly.',
          ],
          mock: (
            <MockTable
              cols={['Creator', 'You', 'Comp A', 'Comp B']}
              rows={[
                ['Aisha Kapoor', '✓', '✓', '—'],
                ['Rohan Mehta', '—', '✓', '✓'],
                ['Neha Sharma', '✓', '—', '✓'],
                ['Bhumika', '—', '✓', '—'],
              ]}
            />
          ),
        },
        {
          title: 'Share of Voice',
          bullets: [
            'Measure your share of creator mentions vs competitors.',
            'Track how it shifts month over month.',
            'Benchmark by category and campaign type.',
            'Find white-space niches competitors are missing.',
          ],
          mock: <MockBars values={[42, 28, 18, 12]} labels={['You', 'Comp A', 'Comp B', 'Comp C']} />,
        },
        {
          title: 'Collaboration Tracking',
          bullets: [
            'Identify the perfect partners with the mentions filter.',
            'See who is collaborating with whom in real time.',
            'Get alerted when a competitor signs a new creator.',
            'Track campaign cadence across the niche.',
          ],
          mock: <MockStats items={[['Creators tracked', '4,782'], ['Competitors', '12'], ['Overlaps', '318'], ['Exclusive wins', '46']]} />,
        },
      ]}
      faqs={[
        { q: 'How do you detect competitor collaborations?', a: 'We analyze paid-partnership tags, brand mentions and collab posts across creators in your niche.' },
        { q: 'What is share of voice?', a: 'Your proportion of creator mentions/collaborations vs competitors in a category over a period.' },
        { q: 'Can I act on overlaps?', a: 'Yes — build target lists or recruit overlapping/exclusive creators straight into a program.' },
      ]}
    />
  );
}
