import { ContractorsDirectory } from "@/components/ContractorsDirectory";
import { loadPublicContractors } from "@/lib/contractors/server";

export default async function ContractorsPage() {
  let contractors = null;
  try {
    contractors = await loadPublicContractors();
  } catch {}
  return contractors
    ? <ContractorsDirectory contractors={contractors} />
    : <ContractorsDirectory contractors={[]} dataError="لا يمكن تحميل دليل المقاولين حاليا. حاول مرة أخرى لاحقا." />;
}
