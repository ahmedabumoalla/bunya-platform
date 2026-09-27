import "server-only";

import { createOriginalClient } from "./session";
import { getImpersonation, impersonatedClient } from "@/lib/auth/impersonation";

export async function createClient() {
  const ticket = await getImpersonation();
  return ticket ? impersonatedClient(ticket) : createOriginalClient();
}
