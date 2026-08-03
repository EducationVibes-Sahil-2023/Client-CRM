import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — EducationVibes",
  description: "How EducationVibes collects, uses, shares and protects personal data, including leads received from Facebook Lead Ads.",
};

// Public, unauthenticated page — used as the Privacy Policy URL for the Meta
// (Facebook) app and anywhere else a public policy link is required.
export default function PrivacyPolicyPage() {
  const updated = "3 August 2026";
  const company = "EducationVibes";
  const domain = "client.educationvibes.in";
  const email = "ittool@educationvibes.in";

  return (
    <main className="mx-auto max-w-3xl px-5 py-12 text-slate-700">
      <h1 className="text-3xl font-bold text-slate-900">Privacy Policy</h1>
      <p className="mt-2 text-sm text-slate-500">Last updated: {updated}</p>

      <p className="mt-6 leading-relaxed">
        This Privacy Policy explains how {company} (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) collects, uses,
        shares and protects personal information when you interact with us — including
        through our website, our enquiry forms, and lead advertisements we run on
        platforms such as Facebook and Instagram (Meta). By submitting your details to
        us, you agree to this policy.
      </p>

      <Section title="Who we are">
        <p>
          {company} operates the customer-relationship system hosted at{" "}
          <span className="font-medium">{domain}</span>. For any privacy questions or
          requests, contact us at{" "}
          <a href={`mailto:${email}`} className="text-emerald-700 underline">{email}</a>.
        </p>
      </Section>

      <Section title="Information we collect">
        <ul className="list-disc space-y-1.5 pl-5">
          <li><b>Contact details</b> you provide: name, phone number, email address, city/state.</li>
          <li><b>Enquiry details</b>: the course, program or service you are interested in, and any message you send.</li>
          <li>
            <b>Lead-ad data from Meta</b>: when you submit a Facebook/Instagram Lead Ad
            form, Meta shares the answers you provided (e.g. name, phone, email) with us
            so we can respond to your enquiry.
          </li>
          <li><b>Usage data</b>: basic technical information (such as submission time) needed to process your enquiry.</li>
        </ul>
      </Section>

      <Section title="How we use your information">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>To contact you about the course/service you enquired about.</li>
          <li>To provide information, counselling, admissions guidance and related services.</li>
          <li>To manage our relationship with you and keep records of your enquiry.</li>
          <li>To comply with legal obligations.</li>
        </ul>
        <p className="mt-2">We do not sell your personal information.</p>
      </Section>

      <Section title="How we share information">
        <p>We only share personal data with:</p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          <li>Our authorised staff and counsellors who handle your enquiry.</li>
          <li>Service providers who help us operate our systems (e.g. hosting), under confidentiality obligations.</li>
          <li>Authorities where required by law.</li>
        </ul>
      </Section>

      <Section title="Data retention">
        <p>
          We keep your personal information only as long as needed to respond to your
          enquiry and for our legitimate business and legal purposes, after which it is
          deleted or anonymised.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          You may request access to, correction of, or deletion of your personal data,
          and you may withdraw consent to further contact at any time. To exercise any
          of these rights, email{" "}
          <a href={`mailto:${email}`} className="text-emerald-700 underline">{email}</a>.
        </p>
      </Section>

      <Section title="Data deletion" id="data-deletion">
        <p>
          To have the personal data we hold about you deleted, email{" "}
          <a href={`mailto:${email}`} className="text-emerald-700 underline">{email}</a>{" "}
          from the email or with the phone number you submitted, with the subject
          &quot;Data deletion request&quot;. We will verify your identity and delete your
          data within 30 days, except where we are legally required to retain it. This
          section also serves as our data-deletion instructions for data received via
          Meta (Facebook/Instagram) Lead Ads.
        </p>
      </Section>

      <Section title="Security">
        <p>
          We use appropriate technical and organisational measures to protect personal
          data against unauthorised access, loss or misuse.
        </p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          We may update this policy from time to time. The &quot;Last updated&quot; date at the
          top shows when it was last revised.
        </p>
      </Section>

      <Section title="Contact us">
        <p>
          {company} —{" "}
          <a href={`mailto:${email}`} className="text-emerald-700 underline">{email}</a>
          <br />
          <span className="text-sm text-slate-500">Website: https://{domain}</span>
        </p>
      </Section>

      <p className="mt-10 border-t border-slate-200 pt-5 text-xs text-slate-400">
        © {company}. This page is provided as our public privacy policy.
      </p>
    </main>
  );
}

function Section({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-8 scroll-mt-20">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <div className="mt-2 space-y-2 leading-relaxed">{children}</div>
    </section>
  );
}
