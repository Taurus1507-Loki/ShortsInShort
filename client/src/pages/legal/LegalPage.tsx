import { Link, useParams } from 'react-router';
import { Notice } from '@/components/ui/primitives';
import { NotFoundPage } from '../app/MiscPages';

/**
 * DRAFT policies. These are starting points written for the product as designed and MUST be reviewed
 * by a qualified lawyer (Indian IT Act, DPDP Act 2023, Consumer Protection (E-Commerce) Rules, GST)
 * before launch.
 */
const DOCS: Record<string, { title: string; sections: [string, string][] }> = {
  terms: {
    title: 'Terms and Conditions',
    sections: [
      ['Agreement', 'By creating an account or using ShortsInShort (“Service”), you agree to these Terms. If you use the Service for an organisation, you confirm you are authorised to bind it.'],
      ['Accounts', 'You must provide accurate information, keep your credentials secure and be at least 18 years old (or the age of majority where you live). You are responsible for activity under your account.'],
      ['Your content', 'You keep ownership of content you upload. You grant us a limited licence to host, process and transform it solely to provide the Service to you. You confirm you have the rights to everything you upload, including the consent of people who appear in it.'],
      ['Credits and plans', 'Processing consumes credits as shown before you confirm each generation. Credits included in a plan may expire at the end of each billing period as described on the pricing page. Credits for failed jobs are returned automatically.'],
      ['Acceptable use', 'You must follow our Acceptable Use Policy. We may suspend accounts that violate it or the law.'],
      ['AI output', 'AI-generated output can be inaccurate or imperfect. Review all output before publishing. You are responsible for how you use it.'],
      ['Termination', 'You may delete your account at any time from Account Settings. We may suspend or terminate access for breach of these Terms.'],
      ['Liability', 'To the extent permitted by law, the Service is provided “as is” and our aggregate liability is limited to the amount you paid us in the 3 months before the claim.'],
      ['Governing law', 'These Terms are governed by the laws of India. [Jurisdiction / courts to be confirmed by counsel.]'],
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    sections: [
      ['What we collect', 'Account data (name, email, hashed password or Google account ID), workspace data (projects, settings, uploads), technical data (IP address, device/browser, sign-in times) and, for avatar features, biometric data (photo, voice sample) only with your explicit consent.'],
      ['Why we use it', 'To provide and secure the Service, process your videos, prevent abuse, send transactional emails (verification, password resets, job notifications) and comply with law. We do not sell personal data.'],
      ['Processors', 'We use vetted sub-processors for hosting, storage, email and AI processing (e.g. transcription, text-to-speech, avatar generation). Content is sent to them only as needed to perform the processing you request. A current list will be published here before launch.'],
      ['Retention', 'Account data is kept while your account is active. When you delete your account it is deactivated immediately and personal data and media are deleted after a short retention window, except where we must keep records by law (e.g. tax invoices).'],
      ['Your rights', 'Under the Digital Personal Data Protection Act, 2023 you may access, correct and erase your data, withdraw consent and nominate a representative. Contact privacy@shortsinshort.com. [Grievance Officer details to be added.]'],
      ['Security', 'We use encryption in transit, hashed passwords (Argon2id), private storage with signed URLs, access controls and audit logs. No system is perfectly secure; we will notify you of breaches as required by law.'],
      ['Cookies', 'We use a strictly necessary, httpOnly cookie to keep you signed in, and store your theme preference in your browser. We do not use advertising cookies.'],
    ],
  },
  refunds: {
    title: 'Refund Policy',
    sections: [
      ['Failed processing', 'If a generation fails on our side, the credits reserved for it are returned to your balance automatically.'],
      ['Subscriptions', 'You can cancel anytime; your plan stays active until the end of the paid period. Except where required by law, payments for a started period are non-refundable. [Final terms to be confirmed before billing launches.]'],
      ['Credit top-ups', 'Unused top-up credits may be refunded within 7 days of purchase if none have been used. [To be confirmed.]'],
      ['How to request', 'Email billing@shortsinshort.com with your account email and payment reference.'],
    ],
  },
  'acceptable-use': {
    title: 'Acceptable Use Policy',
    sections: [
      ['Impersonation and deepfakes', 'You may only create avatars or voice clones of yourself, or of people who have given verified consent through our consent flow. Creating content that impersonates or misrepresents real people without consent is prohibited.'],
      ['Prohibited content', 'No illegal content, child sexual abuse material, non-consensual intimate imagery, harassment, hate speech, incitement to violence, election or health misinformation designed to deceive, or content infringing others’ intellectual property.'],
      ['Platform abuse', 'No attempts to bypass credit limits, rate limits or security controls, resell access without permission, or overload the Service.'],
      ['Enforcement', 'We may remove content, revoke avatars and suspend accounts that violate this policy, and report illegal content to authorities.'],
    ],
  },
  'ai-disclosure': {
    title: 'AI-Generated Content Disclosure',
    sections: [
      ['What is AI-generated', 'ShortsInShort uses AI models to transcribe speech, plan scripts and scenes, select media, synthesise voices and generate avatar video. Output may contain errors.'],
      ['Avatars and synthetic voices', 'Videos featuring a digital avatar or synthetic voice are AI-generated. We recommend — and where platform rules or law require it, you must — label such content as AI-generated when you publish it.'],
      ['Consent', 'Avatar and voice features require explicit, recorded consent from the person depicted. Consent can be revoked at any time, after which the avatar can no longer be used and its assets are deleted.'],
      ['Media licensing', 'Stock footage, images and music added by the Service come from licensed sources. Licence details are recorded per asset.'],
    ],
  },
};

export default function LegalPage() {
  const { slug = '' } = useParams();
  const doc = DOCS[slug];
  if (!doc) return <NotFoundPage />;
  return (
    <article className="container max-w-3xl py-16">
      <p className="text-sm font-semibold uppercase tracking-wider text-accent">Legal</p>
      <h1 className="mt-3 text-4xl font-extrabold">{doc.title}</h1>
      <Notice tone="warning" className="mt-6">
        Draft — pending professional legal review. Not yet in force.
      </Notice>
      <div className="mt-10 grid gap-8">
        {doc.sections.map(([h, body], i) => (
          <section key={h}>
            <h2 className="text-lg font-bold">
              {i + 1}. {h}
            </h2>
            <p className="mt-2 leading-relaxed text-muted-foreground">{body}</p>
          </section>
        ))}
      </div>
      <nav className="mt-14 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-6 text-sm" aria-label="Other policies">
        {Object.entries(DOCS)
          .filter(([k]) => k !== slug)
          .map(([k, d]) => (
            <Link key={k} to={`/legal/${k}`} className="text-muted-foreground hover:text-foreground">
              {d.title}
            </Link>
          ))}
      </nav>
    </article>
  );
}
