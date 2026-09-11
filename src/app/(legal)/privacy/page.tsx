import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell } from "@/components/legal/legal-shell";
import { brand } from "@/lib/brand";
import { LEGAL_LAST_UPDATED, LEGAL_PAGES } from "@/lib/legal";
import { supportEmail, supportMailto } from "@/lib/support";

export const metadata: Metadata = {
  title: LEGAL_PAGES.privacy.title,
  description: LEGAL_PAGES.privacy.description,
};

export default function PrivacyPage() {
  const email = supportEmail();

  return (
    <LegalShell page="privacy">
      <section>
        <h2>1. Introduction</h2>
        <p>
          This Privacy Policy explains how {brand.name} (“ContractorYou,” “we,” “us”) collects, uses, and shares
          information when you use our contractor operating system and related websites. It is written for a
          United States SaaS product used by home-service businesses and their authorized staff.
        </p>
        <p>
          ContractorYou processes business and customer information on behalf of the company that holds the
          ContractorYou account. That company is typically the business that decides what to enter, import, and
          connect. Our <Link href={LEGAL_PAGES.terms.href}>Terms of Service</Link> govern use of the Service. Last
          updated {LEGAL_LAST_UPDATED}.
        </p>
      </section>

      <section>
        <h2>2. Information we collect</h2>
        <h3>Account and company information</h3>
        <p>
          Names, email addresses, hashed passwords, roles, company name, industry, and settings you configure for
          your workspace.
        </p>
        <h3>Customer and operational data entered by business users</h3>
        <p>
          Customer and contact records, properties, jobs, dispatch and scheduling information, estimates, invoices,
          payments, receipts, expenses, job costing, memberships, maintenance plans, notes, photos, and similar
          operational records your team stores in ContractorYou.
        </p>
        <h3>Communications data</h3>
        <p>
          Message content, phone numbers, email addresses, call metadata, and conversation history when you use
          connected communications features.
        </p>
        <h3>Integration data</h3>
        <p>
          Data retrieved from or sent to services you authorize, which may include accounting, payments, messaging,
          marketing, mapping, or AI providers.
        </p>
        <h3>Usage, device, and log data</h3>
        <p>
          IP address, browser or app type, device information, pages viewed, approximate timestamps, diagnostic logs,
          and similar technical data needed to operate and secure the Service.
        </p>
      </section>

      <section>
        <h2>3. How information is collected</h2>
        <ul>
          <li>directly from you and your authorized users when you create an account or enter records;</li>
          <li>through integrations you connect, such as QuickBooks Online, HighLevel, Stripe, or others; and</li>
          <li>automatically through use of the application, including cookies, local storage, and server logs.</li>
        </ul>
      </section>

      <section>
        <h2>4. How information is used</h2>
        <p>We use information to:</p>
        <ul>
          <li>provide, operate, and maintain the Service;</li>
          <li>sync or import data for integrations you authorize;</li>
          <li>support customer communications you initiate through connected providers;</li>
          <li>enable billing, invoicing, and payment collection features;</li>
          <li>understand product usage and improve ContractorYou;</li>
          <li>power AI-assisted features you use;</li>
          <li>detect abuse, secure accounts, and prevent fraud; and</li>
          <li>provide customer support.</li>
        </ul>
        <p>We do not sell personal information or QuickBooks data.</p>
      </section>

      <section>
        <h2>5. Third-party integrations and service providers</h2>
        <p>
          ContractorYou may exchange authorized data with providers you or we use to operate the Service. Depending
          on the features you enable, that may include:
        </p>
        <ul>
          <li>Intuit / QuickBooks Online for accounting history and synchronization;</li>
          <li>HighLevel for phone, SMS, conversations, and related marketing tools;</li>
          <li>Stripe for merchant onboarding and payment processing;</li>
          <li>OpenAI for AI-assisted features;</li>
          <li>Resend for transactional email when configured;</li>
          <li>Google, Meta, or other services you choose to connect; and</li>
          <li>hosting, database, and infrastructure vendors that process data on our behalf.</li>
        </ul>
        <p>
          Those services are governed by their own terms and privacy policies. ContractorYou accesses third-party
          data only when your company authorizes a connection or when a vendor is needed to run the Service.
        </p>
      </section>

      <section>
        <h2>6. QuickBooks / Intuit data</h2>
        <p>
          ContractorYou accesses QuickBooks Online data only after an authorized OAuth connection. Depending on the
          features you enable, that data may include customers, invoices, payments, products and services, expenses,
          and other accounting records available through the authorized scopes.
        </p>
        <p>
          We use QuickBooks data to provide the accounting synchronization, historical import, mapping, preview, and
          reporting functions you request. ContractorYou does not sell QuickBooks data. We send data back to
          QuickBooks only when a feature, setting, or user action requires it — for example, syncing a native
          ContractorYou invoice that you chose to send to QuickBooks. Historical imports are not automatically sent
          back to QuickBooks.
        </p>
        <p>
          You can disconnect QuickBooks from ContractorYou. Disconnecting stops future access through that
          authorization. Historical or imported records that already exist in ContractorYou may remain until you
          delete them through the product or other applicable retention and deletion processes. We do not promise
          that disconnecting QuickBooks wipes ContractorYou.
        </p>
      </section>

      <section>
        <h2>7. AI features</h2>
        <p>
          Certain features may use AI providers such as OpenAI. Relevant business or customer context may be sent to
          the provider as needed to fulfill the requested feature, such as drafting a reply or summarizing a record.
          AI output may be incomplete or inaccurate. Users are responsible for reviewing material business decisions
          and customer communications when appropriate.
        </p>
        <p>
          This policy does not claim that all ContractorYou data is used to train models, and it does not claim that
          any AI provider never trains on submitted data. Training and retention practices are controlled by the
          provider’s terms and our configuration with that provider at the time of use.
        </p>
      </section>

      <section>
        <h2>8. Communications</h2>
        <p>
          Businesses may use ContractorYou with connected providers to send SMS, phone, email, or in-app messaging.
          The business using ContractorYou is responsible for obtaining consent and complying with applicable
          communications laws. Message delivery depends on the connected provider and the recipient’s carrier or
          inbox.
        </p>
      </section>

      <section>
        <h2>9. Payments</h2>
        <p>
          Payment features may use Stripe or another payment provider. ContractorYou does not store full card
          numbers, CVV codes, or bank login credentials. Those details are collected and processed by the payment
          provider. Payment-provider handling is subject to that provider’s terms and privacy policy.
        </p>
      </section>

      <section>
        <h2>10. Data retention</h2>
        <p>
          We retain account, operational, and integration records for as long as your company uses the Service and
          for a reasonable period afterward as needed for backups, disputes, security, legal obligations, or to
          complete deletion processes. Retention periods can vary by record type. Imported QuickBooks or other
          historical records are retained in ContractorYou until deleted through the product or a supported reset /
          deletion process.
        </p>
      </section>

      <section>
        <h2>11. Data deletion and account termination</h2>
        <p>
          Company owners may request deletion of an account by contacting us. We will delete or de-identify Customer
          Data we control when reasonably able to do so, except information we must keep for legal, security,
          accounting, or dispute-resolution reasons, or that remains in short-term backups. Disconnecting an
          integration stops future access to that provider; it may not delete records already stored in
          ContractorYou. We do not promise instant or complete erasure from every backup or log.
        </p>
      </section>

      <section>
        <h2>12. Security</h2>
        <p>
          We use reasonable administrative, technical, and organizational measures designed to protect information,
          including encrypted credentials for connected integrations and access controls inside a company workspace.
          No method of transmission or storage is completely secure, and we do not guarantee that unauthorized access
          will never occur.
        </p>
      </section>

      <section>
        <h2>13. Cookies, local storage, and analytics</h2>
        <p>
          ContractorYou uses cookies and similar technologies that are necessary to sign you in, keep a session, and
          remember workspace preferences. The application may also use local storage for user-interface state. We may
          collect limited product-usage information to operate and improve the Service. We do not use this page to
          claim a specific advertising-cookie program.
        </p>
      </section>

      <section>
        <h2>14. Children’s privacy</h2>
        <p>
          The Service is not directed to children under 13, and we do not knowingly collect personal information from
          children. If you believe a child provided information, contact us and we will take appropriate steps to
          delete it.
        </p>
      </section>

      <section>
        <h2>15. U.S. state privacy rights</h2>
        <p>
          Depending on your state, you may have rights to request access, correction, or deletion of personal
          information, or to appeal a decision. ContractorYou does not sell personal information. If we deny a
          request we believe is unfounded or not required, we will explain why when we can. Authorized agents may
          submit requests with proof of authority. To exercise a privacy right, email{" "}
          <a href={supportMailto()}>{email}</a>.
        </p>
        <p>
          If you are an end customer of a ContractorYou subscriber (for example, a homeowner in that company’s
          database), please contact that business first. We process much of that information on the subscriber’s
          behalf.
        </p>
      </section>

      <section>
        <h2>16. Changes to this policy</h2>
        <p>
          We may update this Privacy Policy from time to time. The updated version will be posted on this page with a
          new last-updated date. Material changes may also be noted in the product when practical.
        </p>
      </section>

      <section>
        <h2>17. Contact</h2>
        <p>
          Privacy questions: <a href={supportMailto()}>{email}</a>. We do not publish a street mailing address on this
          page.
        </p>
      </section>
    </LegalShell>
  );
}
