import { IBM_Plex_Sans } from "next/font/google";
import InvestigationWorkspace from "@/components/v2/InvestigationWorkspace";
import styles from "@/components/v2/workspace.module.css";

const workspaceFont = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });

export default function V2Page() {
  return <div className={`${styles.page} ${workspaceFont.className}`}>
    <div className={styles.pageHeading}><h1>Recovery workspace</h1><p>Synthetic data <span aria-hidden="true">/</span> No real transactions</p></div>
    <InvestigationWorkspace />
  </div>;
}
