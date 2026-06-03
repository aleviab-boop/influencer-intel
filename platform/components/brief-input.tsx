'use client';

import { useState, useRef, useEffect } from 'react';

const PLACEHOLDER = `Festive Diwali campaign for our ghee skincare line — ₹8L budget, target metro women 25–34, prefer creators with past festive content and 85%+ credibility.`;

export function BriefInput({
  onSubmit,
  disabled,
}: {
  onSubmit: (text: string) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && value.trim().length >= 10 && !disabled) {
      e.preventDefault();
      onSubmit(value.trim());
    }
  }

  function handleClick() {
    if (value.trim().length >= 10 && !disabled) onSubmit(value.trim());
  }

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKey}
        rows={5}
        placeholder={PLACEHOLDER}
        disabled={disabled}
        className="w-full px-4 py-3.5 pr-32 rounded-[10px] bg-canvas border border-border text-ink-900 placeholder-ink-400 focus:border-ink-900/40 focus:outline-none focus:ring-4 focus:ring-ink-900/5 resize-none disabled:opacity-50 text-base"
      />
      <button
        onClick={handleClick}
        disabled={disabled || value.trim().length < 10}
        className="absolute bottom-3 right-3 px-4 py-3.5 rounded-[10px] bg-ink-900 hover:bg-ink-900/90 text-white text-base font-medium disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        {disabled ? 'Researching…' : 'Research ⌘⏎'}
      </button>
    </div>
  );
}
