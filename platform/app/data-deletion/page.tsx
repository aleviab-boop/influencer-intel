import type { Metadata } from 'next';
import { LegalPage, Section, Bullets, LEGAL_CONTACT } from '@/components/legal';

export const metadata: Metadata = {
  title: 'Data Deletion — Influencer Intel',
  description: 'How to delete your Influencer Intel data and disconnect Instagram.',
};

export default function DataDeletionPage() {
  return (
    <LegalPage
      title="Data Deletion"
      updated="August 11, 2026"
      intro="You are always in control of your data. Here’s how to disconnect Instagram and delete the information Influencer Intel holds about you."
    >
      <Section heading="Disconnect Instagram">
        <p>You can revoke our access to your Instagram data at any time, in either place:</p>
        <Bullets
          items={[
            <>In our app, open your creator dashboard and choose <strong>Sign out</strong> / disconnect. This deletes the stored access token so we stop accessing new Instagram data.</>,
            <>In Instagram, go to <strong>Settings → Apps and Websites</strong>, find Influencer Intel, and remove it.</>,
          ]}
        />
      </Section>

      <Section heading="Delete your data">
        <p>To request full deletion of your account and associated data:</p>
        <Bullets
          items={[
            <>Email{' '}<a href={`mailto:${LEGAL_CONTACT}?subject=Data%20deletion%20request`} className="font-semibold underline" style={{ textDecorationColor: '#6C4DF6' }}>{LEGAL_CONTACT}</a>{' '}from the address on your account, with the subject “Data deletion request”, and include your Instagram handle.</>,
            'We’ll verify the request and delete your profile, connected-account records, analytics, and stored tokens.',
            'We complete deletion within 30 days and confirm by email. Some records may be retained only where required by law.',
          ]}
        />
      </Section>

      <Section heading="Automatic deletion via Instagram">
        <p>
          If you remove Influencer Intel from your Instagram apps, Instagram notifies us through a secure
          data-deletion callback and we delete the data associated with that connection. This happens
          automatically — you don’t need to do anything else.
        </p>
      </Section>

      <Section heading="Questions">
        <p>
          Need help? Email{' '}
          <a href={`mailto:${LEGAL_CONTACT}`} className="font-semibold underline" style={{ textDecorationColor: '#6C4DF6' }}>
            {LEGAL_CONTACT}
          </a>
          .
        </p>
      </Section>
    </LegalPage>
  );
}
