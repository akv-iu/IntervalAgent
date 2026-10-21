import PageHeader from "@/components/PageHeader";
import VisitorWorkspace from "@/components/v2/VisitorWorkspace";

export default function V2Page() {
  return <>
    <PageHeader title="V2: your billing case" lede="Investigate a dispute using synthetic business records. No real messages or payments are sent. The default worker uses a scripted mock workflow; no live model is enabled by this page." />
    <VisitorWorkspace />
  </>;
}
