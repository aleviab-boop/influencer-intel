import { FeaturePage, MockGrid, MockTable, MockStats } from '@/components/feature-page';

export default function Page() {
  return (
    <FeaturePage
      ctaHref="/media"
      hero={{
        title: 'Manage every campaign creative in one place',
        subtitle:
          'From the first draft to the final approved post, keep all your influencer assets organized, versioned, and brand-safe. No more scattered files across email, WhatsApp and drives — one shared library for your whole team and every creator you work with.',
        mock: <MockGrid count={9} doodle />,
      }}
      sections={[
        {
          title: 'A Single Creative Library',
          bullets: [
            'Store every reel, image, carousel and caption in one searchable place.',
            'Organize assets by campaign, creator, platform and content type.',
            'Tag and filter creatives so the right asset is always one click away.',
            'Share curated collections with teammates or clients via a single link.',
            'Keep raw files and final cuts together so nothing gets lost.',
          ],
          mock: <MockGrid count={9} doodle />,
        },
        {
          title: 'Approval Workflows That Move Fast',
          bullets: [
            'Route every creative through brand approval before it goes live.',
            'Leave timestamped comments and request specific changes inline.',
            'See approval status at a glance for each asset and creator.',
            'Lock approved versions so the wrong cut never gets posted.',
            'Cut approval cycles from days to hours with clear ownership.',
          ],
          mock: (
            <MockTable
              cols={['Asset', 'Creator', 'Status']}
              rows={[
                ['Diwali Reel v2', 'Aisha Kapoor', 'Approved'],
                ['OOTD Carousel', 'Rohan Mehta', 'In review'],
                ['Unboxing Reel', 'Neha Sharma', 'Changes'],
                ['Story set', 'Arjun Rao', 'Approved'],
                ['Festive Teaser', 'Bhumika', 'In review'],
              ]}
            />
          ),
        },
        {
          title: 'Version Control & Audit Trail',
          bullets: [
            'Track every revision of a creative from first draft to final.',
            'Roll back to an earlier version in a single click.',
            'Compare two versions side by side before you decide.',
            'Keep a full audit trail of who changed what, and when.',
            'Never lose an approved asset to an accidental overwrite again.',
          ],
          mock: <MockStats items={[['Assets', '1,204'], ['In review', '38'], ['Approved', '912'], ['Avg approval', '6h']]} />,
        },
        {
          title: 'Brand-Safe Sharing',
          bullets: [
            'Give creators a clear brief and the exact assets they need.',
            'Watermark drafts and control who can download finals.',
            'Reuse top-performing creatives across future campaigns.',
            'Hand finance and legal a clean record of every published asset.',
          ],
          mock: <MockGrid count={6} doodle />,
        },
      ]}
      faqs={[
        { q: 'What can I store?', a: 'Reels, images, carousels, captions and story sets — organized by campaign, creator, platform and content type.' },
        { q: 'How do approvals work?', a: 'Route assets through a review flow with inline comments, change requests and locked approved versions.' },
        { q: 'Is there version history?', a: 'Yes — every revision is tracked with one-click rollback, side-by-side comparison and a full audit trail.' },
        { q: 'Can I share with creators and clients?', a: 'Share curated collections via a link, watermark drafts, and control who can download final assets.' },
      ]}
    />
  );
}
