import { ContractorsDirectory } from "@/components/ContractorsDirectory";
import { loadPublicContractors } from "@/lib/contractors/server";
import { getAuthIdentity } from "@/lib/auth/server";
import { publicAccountFor } from "@/lib/auth/public-account";

export default async function ContractorsPage() {
  const account = publicAccountFor(await getAuthIdentity());
  let contractors = null;
  try {
    contractors = await loadPublicContractors();
  } catch {}
  return contractors
    ? <ContractorsDirectory contractors={contractors} account={account} />
    : <ContractorsDirectory contractors={[]} account={account} dataError="لا يمكن تحميل دليل المقاولين حاليا. حاول مرة أخرى لاحقا." />;
}
