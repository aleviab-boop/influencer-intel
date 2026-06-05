import { FeaturePage, MockTable, MockStats, MockBars } from '@/components/feature-page';

export default function Page() {
  return (
    <FeaturePage
      hero={{
        title: 'The largest scored creator database',
        subtitle: 'Browse 2.4M+ Indian creators across Instagram and YouTube — every profile credibility-scored with 12+ data metrics.',
        mock: (
          <MockTable
            cols={['Creator', 'Followers', 'ER', 'Quality']}
            rows={[
              ['Aisha Kapoor', '248K', '4.8%', '93'],
              ['Rohan Mehta', '512K', '3.1%', '88'],
              ['Neha Sharma', '89K', '6.2%', '90'],
              ['Arjun Rao', '1.2M', '2.4%', '85'],
            ]}
          />
        ),
      }}
      sections={[
        {
          title: 'Powerful Filters',
          bullets: [
            'Filter by category, niche, location, language and tier.',
            'Combine audience demographics with creator traits.',
            'Slice by engagement, followers and content metrics.',
            'Save segments and turn them into target lists.',
          ],
          mock: (
            <MockTable
              cols={['Creator', 'City', 'Category', 'Followers']}
              rows={[
                ['Aisha Kapoor', 'Mumbai', 'Fashion', '248K'],
                ['Neha Sharma', 'Bangalore', 'Beauty', '89K'],
                ['Dev Patel', 'Ahmedabad', 'Tech', '120K'],
                ['Sara Khan', 'Delhi', 'Food', '76K'],
              ]}
            />
          ),
        },
        {
          title: 'Credibility Scores',
          bullets: [
            'Every creator gets a 0–100 quality score.',
            'Fake-follower and engagement-quality signals built in.',
            'Avoid inflated accounts before you spend.',
            'See the score breakdown per creator.',
          ],
          mock: <MockStats items={[['Indexed', '2.4M+'], ['Scored', '1,184'], ['Green ≥80', '63%'], ['Flagged', '4%']]} />,
        },
        {
          title: 'Always-Fresh Data',
          bullets: [
            'Profiles continuously re-scraped and re-scored.',
            'Engagement trends tracked over time.',
            '12+ metrics per creator, 14+ categories, 10+ languages.',
            'New creators added to the directory daily.',
          ],
          mock: <MockBars values={[20, 28, 24, 34, 30, 42]} labels={['M1', 'M2', 'M3', 'M4', 'M5', 'M6']} />,
        },
      ]}
      faqs={[
        { q: 'How big is the database?', a: 'Millions of Indian creators across Instagram and YouTube, continuously indexed and scored.' },
        { q: 'What metrics do you track?', a: 'Followers, engagement rate, per-post likes/comments, audience demographics, credibility and more — 12+ metrics.' },
        { q: 'How fresh is the data?', a: 'Profiles are re-scraped on a rolling basis; stale ones are queued for refresh automatically.' },
      ]}
    />
  );
}
