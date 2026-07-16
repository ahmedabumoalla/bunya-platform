import { ContractorsDirectory } from "@/components/ContractorsDirectory";
import { contractorProfiles } from "@/lib/bunya-contractors";
export default function ContractorsPage() { return <ContractorsDirectory contractors={contractorProfiles} />; }
