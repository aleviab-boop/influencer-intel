// ============================================================
// Deal contract — the deal brief tells a creator WHAT to say back to an invite;
// this turns an agreed deal into the actual paperwork. It expands one
// program_recruits row into a structured influencer collaboration agreement:
// parties, scope, fee & payment terms, timeline, usage rights, disclosure and
// the standard boilerplate clauses — the artifact a brand and creator can both
// point at. Fulfils the "manage contracts" promise on the agency lander.
//
// Pure and deterministic: it only reshapes and templates the one row the route
// fetched. Every clause is a fixed template with the deal's own values slotted
// in — no ML, no LLM, nothing invented or legally advised. "today" is injected
// for testable, timezone-honest date math. Mirrors lib/deal-brief.ts.
// ============================================================

export interface DealContractInput {
  id: string;
  brand: string;
  creator: string;          // display name
  creator_handle: string | null;
  program: string;
  description: string | null;
  deliverables: string | null;
  rate: number;
  paid: boolean;
  paid_at: string | null;    // ISO
  status: string;
  due_date: string | null;   // YYYY-MM-DD
  note: string | null;
  created_at: string | null;  // ISO
  accepted_at: string | null; // ISO — recruit updated_at, when they committed
  // Explicit e-signatures recorded via the sign action (migration 046). When a
  // party has signed, it overrides the lifecycle-derived default for that party.
  signOffs?: DealSignOff[];
}

export interface DealSignOff {
  party: 'brand' | 'creator';
  signer_name: string;
  signed_at: string; // ISO
}

export interface ContractClause {
  n: number;
  heading: string;
  body: string[];
}

export interface ContractParty {
  role: string;   // "Brand (Client)" / "Creator (Contractor)"
  name: string;
  detail: string | null; // @handle etc.
}

export interface DealContract {
  available: boolean;
  id: string;
  reference: string;              // AGR-XXXXXX
  title: string;
  effective_date: string;         // YYYY-MM-DD
  effective_label: string;
  status: 'draft' | 'active' | 'completed';
  status_label: string;
  parties: ContractParty[];
  summary: { label: string; value: string }[];
  clauses: ContractClause[];
  signatures: {
    party_key: 'brand' | 'creator';  // which side this signature belongs to
    party: string;   // who signs (display label)
    name: string;
    signed: boolean;
    signed_label: string | null;  // "Signed 3 Feb 2026" / null
    explicit: boolean;  // true when a real e-signature was recorded (vs. derived)
  }[];
  footnote: string;
}

const DAY_MS = 86_400_000;
const INVITE_STATUSES = new Set(['recruited', 'contacted', 'invited']);

const money = (n: number): string => (n > 0 ? '\u20b9' + n.toLocaleString('en-IN') : '');

function addDays(iso: string, days: number): string {
  const t = new Date(iso + 'T00:00:00Z').getTime();
  if (!Number.isFinite(t)) return iso;
  return new Date(t + days * DAY_MS).toISOString().slice(0, 10);
}

function dateLabel(iso: string): string {
  const d = new Date(iso + (iso.length <= 10 ? 'T00:00:00Z' : ''));
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function parseDeliverables(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/\r?\n|;|\u00b7|\u2022|,(?=\s*\d)/)
    .map((s) => s.replace(/^[\s\-*\u2022\u00b7]+/, '').trim())
    .filter((s) => s.length > 0);
}

// A short, stable, human reference derived from the recruit id (not a secret).
function reference(id: string): string {
  const hex = id.replace(/[^a-f0-9]/gi, '').slice(-6).toUpperCase();
  return 'AGR-' + (hex || '000000').padStart(6, '0');
}

export function buildDealContract(d: DealContractInput, todayISO: string): DealContract {
  const today = todayISO.slice(0, 10);
  const rate = Number(d.rate) || 0;
  const rateStr = money(rate);
  const status = (d.status ?? '').toLowerCase();
  const deliverables = parseDeliverables(d.deliverables);

  // Lifecycle → contract state. An invite not yet accepted is a DRAFT; an
  // accepted, unpaid deal is ACTIVE (in force); a paid deal is COMPLETED.
  let state: DealContract['status'];
  if (d.paid) state = 'completed';
  else if (status === 'invited' || (INVITE_STATUSES.has(status) && !d.accepted_at && status !== 'recruited')) state = 'draft';
  else if (status === 'declined') state = 'draft';
  else state = 'active';

  const statusLabel = state === 'completed' ? 'Completed' : state === 'active' ? 'In force' : 'Draft';

  const effective = (d.accepted_at ?? d.created_at ?? todayISO).slice(0, 10);
  const brandName = d.brand || 'Brand';
  const creatorName = d.creator || 'Creator';
  const handle = d.creator_handle ? '@' + d.creator_handle.replace(/^@/, '') : null;

  const parties: ContractParty[] = [
    { role: 'Brand (Client)', name: brandName, detail: 'Engaging party' },
    { role: 'Creator (Contractor)', name: creatorName, detail: handle },
  ];

  // ---- Summary tiles --------------------------------------------------------
  const summary: { label: string; value: string }[] = [
    { label: 'Fee', value: rateStr || 'To be confirmed' },
    { label: 'Deliverables', value: String(deliverables.length || '—') },
    { label: 'Delivery by', value: d.due_date ? dateLabel(d.due_date) : 'Mutually agreed' },
  ];

  // ---- Clauses (templates; the deal's own values slotted in) ----------------
  const deliverLines = deliverables.length
    ? deliverables.map((x) => `\u2022 ${x}`)
    : ['\u2022 The deliverables as mutually agreed in writing between the parties.'];

  const byWhen = d.due_date ? dateLabel(d.due_date) : 'a date mutually agreed in writing';
  const payWhen = d.paid && d.paid_at
    ? `The Fee was paid in full on ${dateLabel(d.paid_at.slice(0, 10))}.`
    : `The Fee is payable within thirty (30) days of the Client's acceptance of the Deliverables, to the payout details on record for the Creator.`;

  const clauses: ContractClause[] = [
    {
      n: 1,
      heading: 'Engagement',
      body: [
        `${brandName} (the \u201cClient\u201d) engages ${creatorName}${handle ? ` (${handle})` : ''} (the \u201cCreator\u201d) to produce and publish sponsored content for the campaign \u201c${d.program}\u201d (the \u201cCampaign\u201d) on the terms set out below.`,
        d.description ? `Campaign brief: ${d.description.trim()}` : `The Campaign brief will be shared by the Client in writing.`,
      ],
    },
    {
      n: 2,
      heading: 'Deliverables',
      body: [
        'The Creator shall produce and publish the following deliverables (the \u201cDeliverables\u201d):',
        ...deliverLines,
        d.note ? `Additional notes: ${d.note.trim()}` : '',
      ].filter(Boolean),
    },
    {
      n: 3,
      heading: 'Fees & Payment',
      body: [
        rate > 0
          ? `In consideration of the Deliverables and the rights granted herein, the Client shall pay the Creator a total fee of ${rateStr} (the \u201cFee\u201d), inclusive of the Creator's costs unless otherwise agreed in writing.`
          : `The Fee for this engagement shall be as mutually agreed by the parties in writing before work commences.`,
        payWhen,
        'Any applicable taxes shall be handled in accordance with prevailing law; the Client may deduct tax at source (TDS) where required.',
      ],
    },
    {
      n: 4,
      heading: 'Timeline',
      body: [
        `The Creator shall submit the Deliverables for the Client's review, and publish approved content, on or before ${byWhen}.`,
        `Where a live date is specified, published content shall remain live for a minimum of thirty (30) days unless the parties agree otherwise.`,
      ],
    },
    {
      n: 5,
      heading: 'Content Ownership & Usage Rights',
      body: [
        'The Creator retains ownership of the content they create. The Creator grants the Client a non-exclusive, royalty-free licence to repost and share the Deliverables on the Client\u2019s own organic social channels, with attribution to the Creator, for a period of twelve (12) months.',
        'Any paid amplification, whitelisting, or use beyond organic reposting requires the Creator\u2019s prior written consent and may be subject to an additional fee.',
      ],
    },
    {
      n: 6,
      heading: 'Approvals & Revisions',
      body: [
        'The Creator shall submit drafts or content links for the Client\u2019s review prior to publication. The Client may request reasonable revisions within one (1) round; the parties shall act in good faith to finalise the Deliverables promptly.',
        'The Creator retains final editorial control over their voice and creative treatment.',
      ],
    },
    {
      n: 7,
      heading: 'Disclosure & Compliance',
      body: [
        'The Creator shall clearly disclose the paid partnership in accordance with applicable advertising standards (e.g. ASCI / FTC), using conspicuous labels such as \u201c#ad\u201d, \u201c#sponsored\u201d or the platform\u2019s paid-partnership tool.',
        'All content shall be truthful, shall not make unsubstantiated claims, and shall comply with the relevant platform\u2019s terms of service.',
      ],
    },
    {
      n: 8,
      heading: 'Confidentiality',
      body: [
        'Each party shall keep confidential any non-public information disclosed in connection with the Campaign, including unreleased products, pricing and strategy, and shall use it only to perform this agreement.',
      ],
    },
    {
      n: 9,
      heading: 'Termination',
      body: [
        'Either party may terminate this agreement on written notice if the other party materially breaches it and fails to cure within seven (7) days.',
        'On termination, the Client shall pay the Creator for Deliverables completed and accepted up to the termination date.',
      ],
    },
    {
      n: 10,
      heading: 'General',
      body: [
        'This agreement constitutes the entire understanding between the parties regarding the Campaign and supersedes prior discussions. It may be amended only in writing agreed by both parties.',
        'The Creator acts as an independent contractor; nothing herein creates an employment, agency or partnership relationship. This agreement shall be governed by the laws of India.',
      ],
    },
  ];

  // ---- Signature block ------------------------------------------------------
  // Two layers of consent, in priority order:
  //  1. An EXPLICIT e-signature (migration 046) — a party typed their name and
  //     affirmed the terms. This is authoritative and shows the typed name.
  //  2. Otherwise, the lifecycle default: acceptance in-app implies consent
  //     (the Client issued the invite; the Creator accepted it). A draft
  //     (unaccepted) shows both as unsigned.
  const signOffs = d.signOffs ?? [];
  const signOffFor = (party: 'brand' | 'creator'): DealSignOff | undefined =>
    signOffs.find((s) => s.party === party);

  const derivedSigned = state !== 'draft';
  const acceptedLabel = d.accepted_at ? `Accepted ${dateLabel(d.accepted_at.slice(0, 10))}` : (derivedSigned ? 'Accepted' : null);
  const issuedLabel = d.created_at ? `Issued ${dateLabel(d.created_at.slice(0, 10))}` : 'Issued';

  function signatureFor(party: 'brand' | 'creator', label: string, fallbackName: string, derivedLabel: string | null) {
    const explicit = signOffFor(party);
    if (explicit) {
      return {
        party_key: party,
        party: label,
        name: explicit.signer_name || fallbackName,
        signed: true,
        signed_label: `Signed ${dateLabel(explicit.signed_at.slice(0, 10))}`,
        explicit: true,
      };
    }
    return {
      party_key: party,
      party: label,
      name: fallbackName,
      signed: derivedSigned,
      signed_label: derivedSigned ? derivedLabel : null,
      explicit: false,
    };
  }

  const signatures = [
    signatureFor('brand', 'For the Client', brandName, issuedLabel),
    signatureFor('creator', 'The Creator', creatorName, acceptedLabel),
  ];

  const anyExplicit = signOffs.length > 0;
  const bothExplicit = !!signOffFor('brand') && !!signOffFor('creator');
  const footnote = state === 'draft' && !anyExplicit
    ? 'This is a draft agreement generated from the invitation. It takes effect once the Creator accepts the deal.'
    : state === 'completed'
      ? 'This agreement has been fulfilled and the Fee settled in full.'
      : bothExplicit
        ? 'This agreement has been electronically signed by both parties in Influencer Intel.'
        : anyExplicit
          ? 'This agreement has been electronically signed. It takes full effect once both parties sign.'
          : 'This agreement is in force. Both parties accepted its terms in Influencer Intel.';

  return {
    available: true,
    id: d.id,
    reference: reference(d.id),
    title: 'Influencer Collaboration Agreement',
    effective_date: effective,
    effective_label: dateLabel(effective),
    status: state,
    status_label: statusLabel,
    parties,
    summary,
    clauses,
    signatures,
    footnote,
  };
}
