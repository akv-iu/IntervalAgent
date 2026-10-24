import PageHeader from "@/components/PageHeader";
import InvestigationWorkspace from "@/components/v2/InvestigationWorkspace";
import styles from "@/components/v2/workspace.module.css";

export default function V2Page() {
  return <div className={styles.page}>
    <PageHeader title="Case workspace" lede="Choose a client and follow the conversation. The light shows when to play the customer, answer as the business or review as the operator." />
    <InvestigationWorkspace />
  </div>;
}
