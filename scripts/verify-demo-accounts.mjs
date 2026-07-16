import {createHash} from "node:crypto";
import {demoAccountCredentials,demoPasswordProof,demoSeedVersion} from "../src/lib/demo-account-definitions.ts";

const expected={customer:"/customer",provider:"/merchant",contractor:"/contractor"};
for(const account of demoAccountCredentials){
  const proof=createHash("sha256").update(`bunya-local-mock:${account.password}`).digest("hex");
  if(proof!==demoPasswordProof)throw new Error(`Password proof mismatch for ${account.role}`);
  if(expected[account.role]!==account.route)throw new Error(`Route mismatch for ${account.role}`);
  if(!account.id||!account.email||!account.username||!account.mobile)throw new Error(`Incomplete demo account: ${account.role}`);
}
console.log(`Demo accounts verified: ${demoAccountCredentials.length}; seed ${demoSeedVersion}`);
