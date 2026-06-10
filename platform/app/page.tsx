'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Entry gate: send first-time visitors to login, signed-in users into the app.
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    let dest = '/login';
    try {
      if (localStorage.getItem('ii_role') || localStorage.getItem('creator_handle')) dest = '/lander';
    } catch {
      /* ignore */
    }
    router.replace(dest);
  }, [router]);

  return (
    <div className="min-h-screen grid place-items-center bg-white">
      <div className="w-8 h-8 rounded-full border-2 border-[#ece9fb] border-t-[#6C4DF6] animate-spin" />
    </div>
  );
}
