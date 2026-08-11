import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage, Section, Bullets, LEGAL_CONTACT } from '@/components/legal';

export const metadata: Metadata = {
  title: 'Terms of Service — Influencer Intel',
  description: 'The terms that govern your use of Influencer Intel.',
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="August 11, 2026"
      intro="These terms govern your use of Influencer Intel. By creating an account or connecting Instagram, you agree to them."
    >
      <Section heading="Using the service">
        <p>
          You must be at least 18 years old and able to enter into a binding agreement. You are responsible
          for the activity on your account and for keeping your login secure. Use the platform only for
          lawful purposes and in line with Instagram’s own Platform Terms.
        </p>
      </Section>

      <Section heading="Your content and Instagram data">
        <p>
          You retain ownership of your content and your Instagram data. By connecting your account, you
          grant us permission to access and process that data solely to provide the features you use, as
          described in our{' '}
          <Link href="/privacy" className="font-semibold underline" style={{ textDecorationColor: '#6C4DF6' }}>
            Privacy Policy
          </Link>
          . You can revoke this at any time by disconnecting.
        </p>
      </Section>

      <Section heading="Acceptable use">
        <Bullets
          items={[
            'Do not scrape, resell, or misuse other people’s data obtained through the platform.',
            'Do not use the service to send spam, harass, or violate any person’s rights.',
            'Do not attempt to breach, disrupt, or reverse-engineer the platform.',
          ]}
        />
      </Section>

      <Section heading="Campaigns and payments">
        <p>
          Where the platform facilitates brand campaigns and payouts, you agree to provide accurate payout
          details and to deliver on commitments you accept. Payments are processed based on the information
          you supply; we are not responsible for delays caused by incorrect details.
        </p>
      </Section>

      <Section heading="Disclaimers and liability">
        <p>
          The service is provided “as is.” Analytics and estimates (such as estimated media value) are
          informational and not guarantees. To the maximum extent permitted by law, we are not liable for
          indirect or consequential damages arising from your use of the platform.
        </p>
      </Section>

      <Section heading="Termination">
        <p>
          You may stop using the service and delete your account at any time. We may suspend or terminate
          access if these terms are violated. See{' '}
          <Link href="/data-deletion" className="font-semibold underline" style={{ textDecorationColor: '#6C4DF6' }}>
            Data Deletion
          </Link>{' '}
          for how to remove your data.
        </p>
      </Section>

      <Section heading="Contact">
        <p>
          Questions about these terms? Email{' '}
          <a href={`mailto:${LEGAL_CONTACT}`} className="font-semibold underline" style={{ textDecorationColor: '#6C4DF6' }}>
            {LEGAL_CONTACT}
          </a>
          .
        </p>
      </Section>
    </LegalPage>
  );
}
