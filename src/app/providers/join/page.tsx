import { ProviderJoinFlow } from "@/components/JoinApplications";
import { productCategories } from "@/lib/bunya-data";
export default function ProviderJoinPage() { return <ProviderJoinFlow categories={[...productCategories]} />; }
