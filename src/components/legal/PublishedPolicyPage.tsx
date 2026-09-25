import { LegalPage, LegalSection } from "./LegalPage";
import { policyParagraphs } from "@/lib/policies/registry";
import type { PublishedPolicy } from "@/lib/policies/server";

export function PublishedPolicyPage({ policy }: { policy: PublishedPolicy }) {
  return <LegalPage eyebrow="سياسات بُنية" title={policy.title} updatedAt={policy.published_at ?? policy.updated_at}>
    <LegalSection title={policy.summary}>{policyParagraphs(policy.body).map((paragraph, index) => <p key={index} style={{ whiteSpace: "pre-line" }}>{paragraph}</p>)}</LegalSection>
  </LegalPage>;
}
