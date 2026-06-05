import { redirect } from 'next/navigation';

// The old creators directory is now the Influencer Database feature page.
export default function CreatorsPage() {
  redirect('/influencer-database');
}
