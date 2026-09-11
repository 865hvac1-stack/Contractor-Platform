import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell } from "@/components/legal/legal-shell";
import { brand } from "@/lib/brand";
import { LEGAL_GOVERNING_LAW, LEGAL_LAST_UPDATED, LEGAL_PAGES } from "@/lib/legal";
import { supportEmail, supportMailto } from "@/lib/support";

export const metadata: Metadata = {
  title: LEGAL_PAGES.terms.title,
  description: LEGAL_PAGES.terms.description,
};

export default function TermsPage() {
  const email = supportEmail();

  return (
    <LegalShell page="terms">
      <section>
        <h2>1. Acceptance of terms</h2>
        <p>
          These Terms of Service (the “Terms”) are a legally binding agreement between you and the operator of{" "}
          {brand.name} (“we,” “us,” or “ContractorYou”) governing access to and use of the ContractorYou website,
          applications, and related services (the “Service”). By creating an account, accessing the Service, or
          clicking to accept these Terms, you agree to them. If you do not agree, do not use the Service.
        </p>
        <p>
          These Terms function as the end-user license agreement for ContractorYou. Our{" "}
          <Link href={LEGAL_PAGES.privacy.href}>Privacy Policy</Link> explains how we handle information. Last updated{" "}
          {LEGAL_LAST_UPDATED}.
        </p>
      </section>

      <section>
        <h2>2. Eligibility and authority to bind a company</h2>
        <p>
          The Service is intended for businesses and authorized personnel, not for personal consumer use by children.
          You must be at least 18 years old and able to form a binding contract. If you use ContractorYou on behalf of
          a company, you represent that you have authority to bind that company, and “you” includes that company.
        </p>
      </section>

      <section>
        <h2>3. Account registration and security</h2>
        <p>
          You must provide accurate account information and keep credentials confidential. You are responsible for
          activity under your accounts and for promptly notifying us of unauthorized access. We may require additional
          verification for owner, admin, or integration permissions.
        </p>
      </section>

      <section>
        <h2>4. SaaS license and permitted use</h2>
        <p>
          Subject to these Terms, we grant you a limited, non-exclusive, non-transferable, revocable license to access
          the Service for your internal business operations. We retain all rights not expressly granted. You may not
          copy, resell, reverse engineer (except to the limited extent permitted by law), or use the Service to build a
          competing product.
        </p>
      </section>

      <section>
        <h2>5. Customer data ownership</h2>
        <p>
          You retain ownership of the business, customer, job, financial, and other records you or your authorized
          users submit to the Service (“Customer Data”). ContractorYou does not claim ownership of Customer Data. You
          grant us a limited license to host, process, transmit, display, and otherwise use Customer Data only as
          needed to provide, maintain, secure, and improve the Service, and to follow your instructions, including
          authorized integrations.
        </p>
      </section>

      <section>
        <h2>6. Customer responsibilities</h2>
        <p>You are responsible for:</p>
        <ul>
          <li>the accuracy and lawfulness of Customer Data you enter or import;</li>
          <li>how your team uses the Service, including permissions you grant;</li>
          <li>decisions about invoicing, scheduling, communications, and accounting;</li>
          <li>keeping integration connections, tax settings, and payment settings current; and</li>
          <li>reviewing records before you send them to customers or third-party systems.</li>
        </ul>
        <p>
          ContractorYou is software for running a contracting business. We are not your lawyer, CPA, accountant, bank,
          payment processor, telecommunications carrier, or tax advisor.
        </p>
      </section>

      <section>
        <h2>7. Third-party integrations</h2>
        <p>
          You may connect third-party services such as Intuit QuickBooks Online, HighLevel, Stripe, Resend, OpenAI,
          Google services, Meta properties, and other providers you choose. ContractorYou accesses those services only
          after you or your company authorize a connection. Third-party products are governed by their own terms and
          privacy policies. We are not responsible for a provider’s availability, errors, fees, or changes to their
          APIs or policies.
        </p>
      </section>

      <section>
        <h2>8. QuickBooks / Intuit integration</h2>
        <p>
          If you connect QuickBooks Online, ContractorYou uses Intuit’s OAuth process and only accesses QuickBooks data
          you authorize. Depending on enabled features, that may include customers, invoices, payments, products and
          services, expenses, and related accounting records. We use that data to provide the import, mapping,
          synchronization, preview, and reporting functions you request.
        </p>
        <p>
          ContractorYou does not sell QuickBooks data. We send data to QuickBooks only when a feature, setting, or user
          action requires it. Disconnecting QuickBooks in ContractorYou stops future access through that authorization.
          Records already imported or created in ContractorYou may remain until you delete them through the Service or
          applicable retention processes. Disconnecting QuickBooks is not the same as deleting ContractorYou history.
        </p>
      </section>

      <section>
        <h2>9. Communications and consent</h2>
        <p>
          If you use connected providers to send SMS, phone, email, or other messages, you are responsible for consent,
          opt-outs, content, and compliance with applicable communications laws, including TCPA and similar rules. We
          do not guarantee delivery, and we are not the carrier or messaging provider.
        </p>
      </section>

      <section>
        <h2>10. AI-assisted features</h2>
        <p>
          Some features may use AI providers such as OpenAI. Relevant business or customer context may be transmitted
          as needed to fulfill a requested feature. AI output can be incomplete, outdated, or inaccurate. You are
          responsible for reviewing material business decisions and customer-facing communications before you rely on
          them. We do not guarantee AI accuracy.
        </p>
      </section>

      <section>
        <h2>11. Payments and subscription billing</h2>
        <p>
          Payment collection features may use Stripe or another payment provider you connect. Card numbers and
          sensitive payment credentials are handled by the payment provider, not stored as full card numbers by
          ContractorYou. Provider fees, payouts, disputes, and underwriting are subject to that provider’s terms. If
          ContractorYou charges subscription or platform fees, we will describe those fees in the product or an order
          form.
        </p>
      </section>

      <section>
        <h2>12. Fees and taxes</h2>
        <p>
          You are responsible for applicable taxes and for third-party fees (including Intuit, Stripe, messaging, or
          AI usage fees) that are not billed by ContractorYou. Unpaid ContractorYou fees, if any, may result in
          suspension after notice where reasonable.
        </p>
      </section>

      <section>
        <h2>13. Acceptable use</h2>
        <p>
          Use the Service only for lawful business purposes and in a way that does not interfere with other customers,
          our infrastructure, or third-party services. Keep your use consistent with integration provider rules,
          including Intuit’s requirements for QuickBooks apps.
        </p>
      </section>

      <section>
        <h2>14. Prohibited use</h2>
        <p>You may not:</p>
        <ul>
          <li>use the Service for fraud, spam, harassment, or unlawful surveillance;</li>
          <li>attempt to access another company’s data or bypass security or usage limits;</li>
          <li>upload malware or scrape the Service except through documented APIs we provide;</li>
          <li>misrepresent your identity or your authority to connect a third-party account; or</li>
          <li>use ContractorYou to store or process data you do not have the right to process.</li>
        </ul>
      </section>

      <section>
        <h2>15. Intellectual property</h2>
        <p>
          ContractorYou, including software, design, trademarks, and documentation, is owned by us or our licensors.
          Customer Data remains yours. Feedback you provide may be used to improve the Service without obligation to
          you.
        </p>
      </section>

      <section>
        <h2>16. Feedback</h2>
        <p>
          If you send ideas or suggestions, you grant us a perpetual, royalty-free license to use them to operate and
          improve ContractorYou. You are not entitled to compensation or attribution.
        </p>
      </section>

      <section>
        <h2>17. Confidentiality</h2>
        <p>
          Each party may receive non-public information from the other. The receiving party will use that information
          only to perform under these Terms and will protect it with reasonable care. Customer Data is handled as
          described in the Privacy Policy. This section does not limit disclosures required by law.
        </p>
      </section>

      <section>
        <h2>18. Data availability and backups</h2>
        <p>
          We aim to keep the Service available and to maintain backups as part of ordinary operations, but we do not
          guarantee uninterrupted access, error-free operation, or that every record can be restored in every failure
          scenario. You should export or retain copies of records that are critical to your business.
        </p>
      </section>

      <section>
        <h2>19. Suspension and termination</h2>
        <p>
          You may stop using the Service at any time. We may suspend or terminate access if you materially breach these
          Terms, if required by law, or if needed to protect the Service or other customers. After termination, we may
          delete or de-identify Customer Data according to our retention practices, except where we must keep records
          for legal, security, or accounting reasons. Disconnecting an integration does not automatically delete
          imported ContractorYou records.
        </p>
      </section>

      <section>
        <h2>20. Disclaimers</h2>
        <p>
          THE SERVICE IS PROVIDED “AS IS” AND “AS AVAILABLE.” TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE DISCLAIM ALL
          WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
          NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE, INTEGRATIONS, PAYMENTS, COMMUNICATIONS, OR AI FEATURES
          WILL BE UNINTERRUPTED, SECURE, OR ERROR-FREE, OR THAT THEY WILL PRODUCE ANY PARTICULAR LEGAL, ACCOUNTING, TAX,
          OR BUSINESS OUTCOME. WE DO NOT CLAIM HIPAA, SOC 2, OR PCI CERTIFICATION UNLESS WE SEPARATELY STATE THAT A
          SPECIFIC CERTIFICATION HAS BEEN OBTAINED.
        </p>
      </section>

      <section>
        <h2>21. Limitation of liability</h2>
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, CONTRACTORYOU AND ITS OPERATORS WILL NOT BE LIABLE FOR INDIRECT,
          INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR LOST PROFITS, REVENUE, GOODWILL, OR
          DATA, EVEN IF ADVISED OF THE POSSIBILITY. OUR TOTAL LIABILITY FOR ALL CLAIMS RELATING TO THE SERVICE WILL NOT
          EXCEED THE GREATER OF ONE HUNDRED U.S. DOLLARS ($100) OR THE AMOUNTS YOU PAID TO CONTRACTORYOU FOR THE SERVICE
          IN THE TWELVE MONTHS BEFORE THE CLAIM. THESE LIMITS DO NOT APPLY TO LIABILITY THAT CANNOT BE LIMITED UNDER
          APPLICABLE LAW.
        </p>
      </section>

      <section>
        <h2>22. Indemnification</h2>
        <p>
          You will defend and indemnify ContractorYou and its operators against claims arising from your Customer Data,
          your communications, your use of integrations, your violation of law or these Terms, or a dispute between you
          and your customers, technicians, or third-party providers, except to the extent caused by our willful
          misconduct.
        </p>
      </section>

      <section>
        <h2>23. Governing law</h2>
        <p>
          These Terms are governed by the laws of {LEGAL_GOVERNING_LAW}, without regard to conflict-of-law rules. Courts
          located in Tennessee will have exclusive jurisdiction, except that we may seek injunctive relief in any
          jurisdiction to protect intellectual property or confidential information.
        </p>
      </section>

      <section>
        <h2>24. Changes to terms</h2>
        <p>
          We may update these Terms from time to time. We will post the updated Terms on this page and change the last
          updated date. Material changes may also be noted in the product or by email when practical. Continued use
          after the effective date constitutes acceptance of the updated Terms.
        </p>
      </section>

      <section>
        <h2>25. Contact</h2>
        <p>
          Questions about these Terms:{" "}
          <a href={supportMailto()}>{email}</a>. We do not publish a street mailing address on this page.
        </p>
      </section>
    </LegalShell>
  );
}
