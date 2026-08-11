import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage, Section, Bullets, LEGAL_CONTACT } from '@/components/legal';

export const metadata: Metadata = {
  title: 'Privacy Policy — Influencer Intel',
  description: 'How Influencer Intel collects, uses, and protects your data, including data accessed through Instagram.',
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="August 11, 2026"
      intro="This policy explains what information Influencer Intel collects, how we use it, and the choices you have — including the data we access when you connect your Instagram account."
    >
      <Section heading="Who we are">
        <p>
          Influencer Intel (“we”, “us”) is a creator-analytics and campaign platform that helps creators
          measure their own performance and helps brands run influencer campaigns. This policy applies to
          our website, dashboards, and APIs.
        </p>
      </Section>

      <Section heading="Information we collect">
        <Bullets
          items={[
            <><strong>Account details</strong> you provide — name, handle, email, and profile information you add to your creator profile.</>,
            <><strong>Instagram data</strong> you authorize when you connect your account (see the next section).</>,
            <><strong>Usage data</strong> — pages viewed and actions taken in the product, used to operate and improve the service.</>,
            <><strong>Payout details</strong> you choose to add (e.g. UPI or bank information) so brands can pay you. This is stored encrypted and used only to process your payments.</>,
          ]}
        />
      </Section>

      <Section heading="Instagram data we access">
        <p>
          When you connect Instagram, we use the official Instagram API with Instagram Login. We only
          request access to what the product needs, and only after you explicitly authorize it:
        </p>
        <Bullets
          items={[
            <><strong>Profile basics</strong> — your username, account type, follower count, and media count.</>,
            <><strong>Media &amp; insights</strong> — your posts and reels and their metrics (likes, comments, reach, plays, saves, shares) so we can show your analytics.</>,
            <><strong>Audience insights</strong> — aggregated, anonymized demographics (age ranges, gender split, top locations) about the people who follow you.</>,
            <><strong>Comments &amp; messaging</strong> — only if you enable Comment-to-DM automations, to reply to comments and send the direct messages you configure.</>,
          ]}
        />
        <p>
          We never receive your Instagram password. Access is granted by a token you can revoke at any
          time from your Instagram settings or by disconnecting in our app.
        </p>
      </Section>

      <Section heading="How we use your information">
        <Bullets
          items={[
            'To show you your own analytics — engagement, growth, top content, audience, and estimated media value.',
            'To build your media kit and rate card, and to match you with relevant brand campaigns.',
            'To run automations you set up (such as replying to comments with a DM).',
            'To operate, secure, and improve the platform.',
          ]}
        />
        <p>We do not sell your personal data.</p>
      </Section>

      <Section heading="How we share information">
        <p>
          We share data only as needed to provide the service: with brands you choose to apply to or work
          with (limited to your public creator profile and the analytics you agree to surface), and with
          infrastructure providers that host and process data on our behalf under confidentiality
          obligations. We may disclose information if required by law.
        </p>
      </Section>

      <Section heading="Data retention">
        <p>
          We keep your information for as long as your account is active or as needed to provide the
          service. You can request deletion at any time — see{' '}
          <Link href="/data-deletion" className="font-semibold underline" style={{ textDecorationColor: '#6C4DF6' }}>
            Data Deletion
          </Link>
          . When you disconnect Instagram, we stop accessing new Instagram data and delete the stored
          access token.
        </p>
      </Section>

      <Section heading="Your choices and rights">
        <Bullets
          items={[
            'Disconnect Instagram at any time from the app or from your Instagram account settings.',
            'Request a copy of your data, or ask us to correct or delete it.',
            'Delete your account, which removes your profile and associated data as described in our Data Deletion page.',
          ]}
        />
      </Section>

      <Section heading="Security">
        <p>
          We use encryption in transit and at rest for sensitive fields (such as access tokens and payout
          details) and restrict internal access. No system is perfectly secure, but we work to protect
          your data and to promptly address any issues.
        </p>
      </Section>

      <Section heading="Contact us">
        <p>
          Questions about this policy or your data? Email{' '}
          <a href={`mailto:${LEGAL_CONTACT}`} className="font-semibold underline" style={{ textDecorationColor: '#6C4DF6' }}>
            {LEGAL_CONTACT}
          </a>
          .
        </p>
      </Section>
    </LegalPage>
  );
}
