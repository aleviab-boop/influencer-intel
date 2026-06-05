import { redirect } from 'next/navigation';

// The old creators directory now lives at the functional database browser.
export default function CreatorsPage() {
  redirect('/database');
}
