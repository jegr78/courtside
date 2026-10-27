import { useState, type ReactNode } from "react";
import { ProofOwnerContext } from "../security/reauthentication";

export function proofOwnerHarness() {
  let changeOwner: (owner: string) => void = () => { throw new Error("The proof owner is not mounted"); };
  function Wrapper({ children }: { children: ReactNode }) {
    const [owner, setOwner] = useState("doe.jane");
    changeOwner = setOwner;
    return <ProofOwnerContext value={owner}>{children}</ProofOwnerContext>;
  }
  return { Wrapper, change: () => changeOwner("roe.john") };
}
