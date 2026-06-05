import { FeaturePage, MockBars, MockStats, MockTable } from '@/components/feature-page';

export default function Page() {
  return (
    <FeaturePage
      ctaHref="/analytics"
      hero={{
        title: 'Predicted vs. real campaign analytics',
        subtitle: 'Forecast a post’s likes and views before it goes live, then measure the gap against real results — all in real time.',
        mock: <MockBars values={[30, 44, 26, 50, 38, 56]} labels={['P1', 'P2', 'P3', 'P4', 'P5', 'P6']} />,
      }}
      sections={[
        {
          title: 'Performance Prediction',
          bullets: [
            'Predict likes, views and engagement rate per creator.',
            'See a confidence band and best posting window.',
            'Score content concepts before you commission them.',
            'Compare creators on expected performance, not vanity reach.',
          ],
          mock: <MockBars values={[34, 48, 40, 58]} labels={['Predicted', 'Actual', 'Predicted', 'Actual']} />,
        },
        {
          title: 'Real-time Dashboards',
          bullets: [
            'Live metrics across every campaign in one dashboard.',
            'Track reach, likes, comments and conversions as they land.',
            'Roll up performance by program, creator or platform.',
            'Spot breakout posts the moment they take off.',
          ],
          mock: <MockStats items={[['Live campaigns', '6'], ['Predicted ER', '4.3%'], ['Actual ER', '3.9%'], ['Accuracy', '91%']]} />,
        },
        {
          title: 'Custom Reporting',
          bullets: [
            'Build reports with the metrics that matter to you.',
            'Export shareable summaries for stakeholders.',
            'Compare predicted vs actual across posts.',
            'Attribute outcomes back to creators and content.',
          ],
          mock: (
            <MockTable
              cols={['Post', 'Predicted', 'Actual', 'Δ']}
              rows={[
                ['Reel A', '12.0K', '9.8K', '−18%'],
                ['Reel B', '8.4K', '9.1K', '+8%'],
                ['Reel C', '21.0K', '22.4K', '+7%'],
                ['Reel D', '5.0K', '4.2K', '−16%'],
              ]}
            />
          ),
        },
      ]}
      faqs={[
        { q: 'How accurate are predictions?', a: 'Predictions use each creator’s baseline engagement plus content, timing and trend signals; accuracy improves as real outcomes accumulate.' },
        { q: 'Can I log real results?', a: 'Yes — record actual likes/views per post and the dashboard charts predicted vs real automatically.' },
        { q: 'Do you support custom reports?', a: 'Build reports with your chosen metrics and export them for stakeholders.' },
      ]}
    />
  );
}
