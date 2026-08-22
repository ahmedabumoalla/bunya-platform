import { RegisterFlow } from "@/components/AuthFlows";
export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const params = await searchParams;
  return <RegisterFlow returnTo={params.returnTo} />;
}
