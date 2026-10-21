import { Suspense } from "react";
import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import VisitorWorkspace from "@/components/v2/VisitorWorkspace";
import { slug } from "@/lib/artifact";

export default function V2CasePage({ params }: PageProps<"/v2/cases/[caseId]">) {
  return <>
    <PageHeader title="V2: your billing case" lede="Synthetic records. Messages and case status are saved on the server. Internal agent drafts and financial proposals are not customer replies." />
    <Suspense fallback={<p role="status" className="mt-6">Loading case...</p>}><Case params={params} /></Suspense>
  </>;
}

async function Case({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  if (!slug.safeParse(caseId).success) notFound();
  return <VisitorWorkspace key={caseId} caseId={caseId} />;
}
