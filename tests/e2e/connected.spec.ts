import { createHmac, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  ConnectedHarness,
  E2E_RUN_ID,
  ROLE_ROOTS,
  loginAs,
  signHook,
  startProviderMock,
  type E2ERole,
  type E2EUser,
} from "./connected-harness";

test.describe.configure({ mode: "serial" });

test("real connected E2E platform validation", async ({ browser }) => {
  const harness = new ConnectedHarness();
  const providerMock = await startProviderMock();
  const consoleErrors: string[] = [];
  const networkErrors: string[] = [];
  const users = {} as Record<E2ERole, E2EUser>;
  const blockers: string[] = [];
  let providerId = "";
  let contractorId = "";
  let driverId = "";
  let contractorProjectId = "";
  let contractorServiceId = "";
  let commerceResponseId = "";
  let commerceAssignmentId = "";
  let rlsPeer: E2EUser;
  let primaryFailure: unknown;

  try {
    await test.step("OTP hook rejects invalid requests and uses mocked transports once", async () => {
      const otp = String(100000 + Math.floor(Math.random() * 899999));
      const raw = JSON.stringify({ user: { phone: "+966500000001", email: "otp@invalid.example" }, sms: { otp } });
      const webhookId = `otp-${E2E_RUN_ID}`;
      const timestamp = String(Math.floor(Date.now() / 1000));
      const valid = await fetch("http://127.0.0.1:3100/api/auth/hooks/send-sms", {
        method: "POST",
        body: raw,
        headers: {
          "content-type": "application/json",
          "webhook-id": webhookId,
          "webhook-timestamp": timestamp,
          "webhook-signature": signHook(raw, webhookId, timestamp),
        },
      });
      expect(valid.status).toBe(204);
      expect(await valid.text()).not.toContain(otp);
      expect(providerMock.calls.green).toBe(1);
      expect(providerMock.calls.resend).toBe(1);

      const badSignature = await fetch("http://127.0.0.1:3100/api/auth/hooks/send-sms", {
        method: "POST",
        body: raw,
        headers: {
          "content-type": "application/json",
          "webhook-id": `${webhookId}-bad`,
          "webhook-timestamp": timestamp,
          "webhook-signature": "v1,invalid",
        },
      });
      expect(badSignature.status).toBe(401);
      expect(await badSignature.text()).not.toContain(otp);

      const incompleteRaw = JSON.stringify({ user: { phone: "+966500000001" }, sms: {} });
      const incompleteId = `${webhookId}-missing`;
      const incomplete = await fetch("http://127.0.0.1:3100/api/auth/hooks/send-sms", {
        method: "POST",
        body: incompleteRaw,
        headers: {
          "content-type": "application/json",
          "webhook-id": incompleteId,
          "webhook-timestamp": timestamp,
          "webhook-signature": signHook(incompleteRaw, incompleteId, timestamp),
        },
      });
      expect(incomplete.status).toBe(400);
      expect(providerMock.calls.green).toBe(1);
      expect(providerMock.calls.resend).toBe(1);

      const submissions = await harness.serviceRows(
        "notification_provider_submissions",
        `select=id,event_type,channel,masked_destination,idempotency_key,status,sanitized_error&idempotency_key=in.(otp-wa-${webhookId},otp-email-${webhookId})`,
      );
      expect(submissions).toHaveLength(2);
      for (const row of submissions) harness.track("notification_provider_submissions", String(row.id));
      expect(JSON.stringify(submissions)).not.toContain(otp);
    });

    await test.step("create confirmed temporary users and official role records", async () => {
      users.admin = await harness.createE2EUser("admin");
      users.customer = await harness.createE2EUser("customer");
      users.provider = await harness.createE2EUser("provider");
      users.contractor = await harness.createE2EUser("contractor");
      users.driver = await harness.createE2EUser("driver");

      await harness.setRole(users.admin, "admin", users.admin.id);
      const superRoles = await harness.serviceRows("admin_roles", "select=id&role_key=eq.super_admin&limit=1");
      expect(superRoles).toHaveLength(1);
      const adminRows = await harness.insert("admin_users", {
        profile_id: users.admin.id,
        role_id: superRoles[0].id,
        is_active: true,
      });
      harness.track("admin_users", String(adminRows[0].id));

      await harness.setRole(users.customer, "customer", users.admin.id);
      await harness.insert("customer_profiles", { profile_id: users.customer.id });

      await harness.setRole(users.provider, "provider", users.admin.id);
      const providerRows = await harness.insert("providers", {
        owner_profile_id: users.provider.id,
        company_name: `${E2E_RUN_ID}-provider`,
        contact_name: `${E2E_RUN_ID}-owner`,
        mobile: users.provider.phone,
        email: users.provider.email,
        status: "approved",
        reviewed_by: users.admin.id,
        reviewed_at: new Date().toISOString(),
        review_notes: E2E_RUN_ID,
      });
      providerId = String(providerRows[0].id);
      harness.track("providers", providerId);
      await harness.insert("provider_profiles", { provider_id: providerId, username: `e2e${Date.now()}`, delivery_available: true });
      await harness.insert("provider_members", { provider_id: providerId, profile_id: users.provider.id, member_role: "owner", is_active: true });
      await harness.insert("provider_settings", { provider_id: providerId, delivery_available: true });

      await harness.setRole(users.contractor, "contractor", users.admin.id);
      const contractorApplicationRows = await harness.insert("contractor_applications", {
        applicant_profile_id: users.contractor.id,
        contractor_name: `${E2E_RUN_ID}-contractor`,
        mobile: users.contractor.phone,
        email: users.contractor.email,
        status: "approved",
        reviewed_by: users.admin.id,
        reviewed_at: new Date().toISOString(),
        review_notes: E2E_RUN_ID,
      });
      const contractorApplicationId = String(contractorApplicationRows[0].id);
      harness.track("contractor_applications", contractorApplicationId);
      const contractorRows = await harness.insert("contractor_profiles", {
        profile_id: users.contractor.id,
        application_id: contractorApplicationId,
        display_name: `${E2E_RUN_ID}-contractor`,
        commercial_name: `${E2E_RUN_ID}-contractor`,
        city: "Riyadh",
        badge: "E2E",
        years_experience: 5,
        summary: `${E2E_RUN_ID} connected contractor fixture`,
        phone: users.contractor.phone,
        email: users.contractor.email,
        subscription_active: true,
        approval_status: "approved",
        availability: "available",
        directory_visible: true,
      });
      contractorId = String(contractorRows[0].id);
      harness.track("contractor_profiles", contractorId);
      await harness.insert("contractor_profile_specialties", { profile_id: contractorId, specialty_name: `${E2E_RUN_ID}-specialty`, sort_order: 0 });
      await harness.insert("contractor_profile_regions", { profile_id: contractorId, region_name: "Riyadh" });
      await harness.insert("contractor_availability", { contractor_profile_id: contractorId, status: "available", note: E2E_RUN_ID });

      await harness.setRole(users.driver, "driver", users.admin.id);
      const driverRows = await harness.insert("provider_drivers", {
        provider_id: providerId,
        full_name: `${E2E_RUN_ID}-driver`,
        mobile: users.driver.phone,
        email: users.driver.email,
        username: `driver${Date.now()}`,
        status: "active",
        must_change_password: false,
        internal_notes: E2E_RUN_ID,
        created_by_provider_id: providerId,
      });
      driverId = String(driverRows[0].id);
      harness.track("provider_drivers", driverId);
      await harness.insert("provider_driver_accounts", { driver_id: driverId, auth_user_id: users.driver.id });

      rlsPeer = await harness.createE2EUser("provider", "rls-peer");
      await harness.setRole(rlsPeer, "provider", users.admin.id);
      const peerProviderRows = await harness.insert("providers", {
        owner_profile_id: rlsPeer.id,
        company_name: `${E2E_RUN_ID}-peer-provider`,
        contact_name: `${E2E_RUN_ID}-peer`,
        mobile: rlsPeer.phone,
        email: rlsPeer.email,
        status: "approved",
        reviewed_by: users.admin.id,
        reviewed_at: new Date().toISOString(),
        review_notes: "RLS peer fixture",
      });
      const peerProviderId = String(peerProviderRows[0].id);
      harness.track("providers", peerProviderId);
      const peerMemberRows = await harness.insert("provider_members", { provider_id: peerProviderId, profile_id: rlsPeer.id, member_role: "owner", is_active: true });
      harness.track("provider_members", String(peerMemberRows[0].id));
      const peerApplicationRows = await harness.insert("contractor_applications", {
        applicant_profile_id: rlsPeer.id,
        contractor_name: `${E2E_RUN_ID}-peer-contractor`,
        mobile: rlsPeer.phone,
        email: rlsPeer.email,
        status: "approved",
        reviewed_by: users.admin.id,
        reviewed_at: new Date().toISOString(),
        review_notes: "RLS peer fixture",
      });
      const peerApplicationId = String(peerApplicationRows[0].id);
      harness.track("contractor_applications", peerApplicationId);
      const peerContractorRows = await harness.insert("contractor_profiles", {
        profile_id: rlsPeer.id,
        application_id: peerApplicationId,
        display_name: `${E2E_RUN_ID}-peer-contractor`,
        commercial_name: `${E2E_RUN_ID}-peer-contractor`,
        city: "Riyadh",
        badge: "E2E",
        years_experience: 1,
        summary: "RLS peer fixture",
        phone: rlsPeer.phone,
        email: rlsPeer.email,
        subscription_active: false,
        approval_status: "approved",
        availability: "available",
        directory_visible: false,
      });
      harness.track("contractor_profiles", String(peerContractorRows[0].id));
      const peerDriverRows = await harness.insert("provider_drivers", {
        provider_id: peerProviderId,
        full_name: `${E2E_RUN_ID}-peer-driver`,
        mobile: rlsPeer.phone,
        email: rlsPeer.email,
        username: `peerdriver${Date.now()}`,
        status: "active",
        must_change_password: false,
        internal_notes: "RLS peer fixture",
        created_by_provider_id: peerProviderId,
      });
      const peerDriverId = String(peerDriverRows[0].id);
      harness.track("provider_drivers", peerDriverId);
      await harness.insert("provider_driver_accounts", { driver_id: peerDriverId, auth_user_id: rlsPeer.id });

      for (const user of Object.values(users)) await harness.signIn(user);
      await harness.signIn(rlsPeer);
    });

    await test.step("real UI login, cookies, refresh, role redirects and route isolation", async () => {
      for (const role of Object.keys(users) as E2ERole[]) {
        const context = await browser.newContext();
        const page = await context.newPage();
        observe(page, consoleErrors, networkErrors);
        await loginAs(page, users[role]);
        expect(new URL(page.url()).pathname.startsWith(ROLE_ROOTS[role])).toBeTruthy();
        if (role !== "admin") {
          const result = await page.evaluate(async () => {
            const response = await fetch("/api/admin/join-requests/provider");
            return response.status;
          });
          expect([401, 403]).toContain(result);
        }
        await context.close();
      }
      expect(consoleErrors).toEqual([]);
      expect(networkErrors).toEqual([]);
    });

    await test.step("JWT refresh and direct RLS attack checks", async () => {
      const tokenBefore = users.customer.accessToken;
      await harness.refresh(users.customer);
      expect(users.customer.accessToken).not.toBe(tokenBefore);

      const customerSeesAdmin = await harness.userRows(users.customer, "admin_users", "select=id&limit=5");
      const providerSeesAdmin = await harness.userRows(users.provider, "admin_users", "select=id&limit=5");
      const contractorSeesAdmin = await harness.userRows(users.contractor, "admin_users", "select=id&limit=5");
      const driverSeesAdmin = await harness.userRows(users.driver, "admin_users", "select=id&limit=5");
      expect(customerSeesAdmin).toEqual([]);
      expect(providerSeesAdmin).toEqual([]);
      expect(contractorSeesAdmin).toEqual([]);
      expect(driverSeesAdmin).toEqual([]);

      const customerReadsProvider = await harness.userRows(users.customer, "provider_members", `select=provider_id&profile_id=eq.${users.provider.id}`);
      const providerUpdatesContractor = await harness.update(
        "contractor_profiles",
        `id=eq.${contractorId}`,
        { summary: "unauthorized-e2e-change" },
        { token: users.provider.accessToken },
      );
      expect(customerReadsProvider).toEqual([]);
      expect(providerUpdatesContractor).toEqual([]);
    });

    await test.step("RFQ, provider response, quote assembly, reject and accept", async () => {
      let products = await harness.serviceRows(
        "products",
        "select=id,name,base_unit&is_published=eq.true&review_status=eq.approved&limit=1",
      );
      if (!products.length) {
        const categoryRows = await harness.insert("product_categories", {
          name: `${E2E_RUN_ID}-category`,
          slug: `${E2E_RUN_ID}-category`,
          sort_order: 9999,
          is_active: true,
        });
        const categoryId = String(categoryRows[0].id);
        harness.track("product_categories", categoryId);
        const productRows = await harness.insert("products", {
          category_id: categoryId,
          slug: `${E2E_RUN_ID}-product`,
          sku: `E2E-${Date.now()}`,
          name: `${E2E_RUN_ID}-product`,
          base_unit: "unit",
          short_description: E2E_RUN_ID,
          description: `${E2E_RUN_ID} connected product`,
          full_description: `${E2E_RUN_ID} connected product fixture`,
          availability_summary: "available",
          availability_status: "available",
          lead_time_label: "2 hours",
          delivery_label: "delivery",
          delivery_window: "4 hours",
          delivery_notes: E2E_RUN_ID,
          is_new: true,
          is_published: true,
          created_by: users.admin.id,
          provider_id: providerId,
          review_status: "approved",
          offer_type: "sale",
          vat_inclusive: false,
        });
        harness.track("products", String(productRows[0].id));
        products = [{ id: productRows[0].id, name: productRows[0].name, base_unit: productRows[0].base_unit }];
      }
      const product = products[0];
      let plans = await harness.serviceRows("subscription_plans", "select=id&role=eq.provider&is_active=eq.true&limit=1");
      if (!plans.length) {
        const planRows = await harness.insert("subscription_plans", {
          id: `${E2E_RUN_ID}-provider-plan`,
          role: "provider",
          name: `${E2E_RUN_ID}-plan`,
          price_monthly: 0,
          description: E2E_RUN_ID,
          benefits: ["connected-e2e"],
          is_active: true,
        });
        harness.track("subscription_plans", String(planRows[0].id));
        plans = planRows;
      }
      const subscriptionRows = await harness.insert("subscriptions", {
        profile_id: users.provider.id,
        plan_id: plans[0].id,
        status: "active",
        starts_at: new Date(Date.now() - 3_600_000).toISOString(),
        ends_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      });
      harness.track("subscriptions", String(subscriptionRows[0].id));
      const priceRows = await harness.insert("provider_product_prices", {
        provider_id: providerId,
        product_id: product.id,
        unit_price: 100,
        vat_inclusive: false,
        expires_at: new Date(Date.now() + 48 * 3_600_000).toISOString(),
        freshness_status: "valid",
      });
      harness.track("provider_product_prices", String(priceRows[0].id));

      const rejected = await createCommerceQuote("reject", product);
      if (!rejected) return;
      const rejectResult = await harness.rpc("reject_customer_quote", { p_quote_id: rejected.quoteId }, { token: users.customer.accessToken });
      expect(rejectResult.ok).toBeTruthy();
      const rejectedRows = await harness.serviceRows("bunya_customer_quotes", `select=status&id=eq.${rejected.quoteId}`);
      expect(rejectedRows[0].status).toBe("rejected");
      const decoyOrders = await harness.insert("orders", {
        order_code: `E2E-PEER-${Date.now()}`,
        customer_quote_id: rejected.quoteId,
        customer_profile_id: rlsPeer.id,
        subtotal: 1,
        vat_amount: 0,
        delivery_fee: 0,
        discount_amount: 0,
        total: 1,
        payment_status: "pending",
        status: "confirmed",
        notes: "RLS peer fixture",
      });
      const decoyOrderId = String(decoyOrders[0].id);
      harness.track("orders", decoyOrderId);
      expect(await harness.userRows(users.customer, "orders", `select=id&id=eq.${decoyOrderId}`)).toEqual([]);

      const accepted = await createCommerceQuote("accept", product);
      if (!accepted) return;
      commerceResponseId = accepted.responseId;
      const quoteForCustomer = await harness.userRows(
        users.customer,
        "bunya_customer_quotes",
        `select=id,subtotal,vat_amount,delivery_fee,total,status&id=eq.${accepted.quoteId}`,
      );
      expect(quoteForCustomer).toHaveLength(1);
      expect(quoteForCustomer[0].status).toBe("ready");
      const hiddenSelections = await harness.userRows(
        users.customer,
        "selected_provider_items",
        `select=id,provider_id&sourcing_request_item_id=eq.${accepted.sourcingItemId}`,
      );
      expect(hiddenSelections).toEqual([]);
      expect(await harness.userRows(rlsPeer, "provider_pricing_responses", `select=id&id=eq.${commerceResponseId}`)).toEqual([]);

      const acceptanceKey = `${E2E_RUN_ID}-accept-order`;
      const acceptedOrder = await harness.rpc(
        "accept_customer_quote",
        { p_quote_id: accepted.quoteId, p_idempotency_key: acceptanceKey },
        { token: users.customer.accessToken },
      );
      const orderId = String(acceptedOrder.data);
      expect(orderId).toMatch(/^[0-9a-f-]{36}$/i);
      harness.track("orders", orderId);
      const duplicateAccept = await harness.rpc(
        "accept_customer_quote",
        { p_quote_id: accepted.quoteId, p_idempotency_key: acceptanceKey },
        { token: users.customer.accessToken },
      );
      expect(String(duplicateAccept.data)).toBe(orderId);

      const orderItems = await harness.serviceRows("order_items", `select=id&order_id=eq.${orderId}`);
      expect(orderItems.length).toBeGreaterThan(0);
      for (const row of orderItems) harness.track("order_items", String(row.id));
      const invoices = await harness.serviceRows("invoices", `select=id,status,total&order_id=eq.${orderId}`);
      expect(invoices).toHaveLength(1);
      expect(invoices[0].status).toBe("unpaid");
      const invoiceId = String(invoices[0].id);
      harness.track("invoices", invoiceId);
      const invoiceItems = await harness.serviceRows("invoice_items", `select=id&invoice_id=eq.${invoiceId}`);
      expect(invoiceItems.length).toBeGreaterThan(0);
      for (const row of invoiceItems) harness.track("invoice_items", String(row.id));
      const payments = await harness.serviceRows("payment_records", `select=id,status,amount&invoice_id=eq.${invoiceId}`);
      expect(payments).toHaveLength(1);
      expect(payments[0].status).toBe("pending");
      const paymentId = String(payments[0].id);
      harness.track("payment_records", paymentId);
      const fulfillments = await harness.serviceRows(
        "internal_fulfillment_orders",
        `select=id,status,payment_released_at&bunya_customer_quote_id=eq.${accepted.quoteId}`,
      );
      expect(fulfillments).toHaveLength(1);
      expect(fulfillments[0].payment_released_at).toBeNull();
      const fulfillmentId = String(fulfillments[0].id);
      harness.track("internal_fulfillment_orders", fulfillmentId);
      const prepaymentProviderView = await harness.userRows(
        users.provider,
        "internal_fulfillment_orders",
        `select=id&id=eq.${fulfillmentId}`,
      );
      expect(prepaymentProviderView).toEqual([]);

      const paymentEvent = {
        id: `${E2E_RUN_ID}-payment-succeeded`,
        type: "payment.succeeded",
        payment_record_id: paymentId,
        gateway_reference: `${E2E_RUN_ID}-gateway`,
      };
      const rawEvent = JSON.stringify(paymentEvent);
      const invalidPayment = await fetch("http://127.0.0.1:3100/api/payments/events", {
        method: "POST",
        headers: { "content-type": "application/json", "x-bunya-signature": "invalid" },
        body: rawEvent,
      });
      expect(invalidPayment.status).toBe(401);
      const signature = createHmac("sha256", String(process.env.PAYMENT_EVENTS_SECRET)).update(rawEvent).digest("hex");
      const validPayment = await fetch("http://127.0.0.1:3100/api/payments/events", {
        method: "POST",
        headers: { "content-type": "application/json", "x-bunya-signature": `sha256=${signature}` },
        body: rawEvent,
      });
      expect(validPayment.status).toBe(200);
      const validPaymentBody = await validPayment.json() as { accepted: boolean; duplicate: boolean };
      expect(validPaymentBody).toEqual({ accepted: true, duplicate: false });
      expect(providerMock.calls.deliveryCodes.length).toBeGreaterThan(0);
      const firstDeliveryCode = providerMock.calls.deliveryCodes.at(-1)!;

      const duplicatePayment = await fetch("http://127.0.0.1:3100/api/payments/events", {
        method: "POST",
        headers: { "content-type": "application/json", "x-bunya-signature": `sha256=${signature}` },
        body: rawEvent,
      });
      expect(duplicatePayment.status).toBe(200);
      expect(await duplicatePayment.json()).toMatchObject({ accepted: true, duplicate: true });
      const paidRows = await harness.serviceRows("payment_records", `select=status&id=eq.${paymentId}`);
      const paidInvoices = await harness.serviceRows("invoices", `select=status&id=eq.${invoiceId}`);
      const paidOrders = await harness.serviceRows("orders", `select=payment_status,status&id=eq.${orderId}`);
      expect(paidRows[0].status).toBe("succeeded");
      expect(paidInvoices[0].status).toBe("paid");
      expect(paidOrders[0].payment_status).toBe("paid");
      const trusted = await harness.serviceRows("trusted_payment_events", `select=event_id&event_id=eq.${paymentEvent.id}`);
      expect(trusted).toHaveLength(1);
      harness.track("trusted_payment_events", paymentEvent.id);

      const assignments = await harness.serviceRows(
        "provider_delivery_assignments",
        `select=id,status,assigned_driver_id&fulfillment_order_id=eq.${fulfillmentId}`,
      );
      expect(assignments).toHaveLength(1);
      const assignmentId = String(assignments[0].id);
      commerceAssignmentId = assignmentId;
      harness.track("provider_delivery_assignments", assignmentId);
      expect(await harness.userRows(rlsPeer, "provider_delivery_assignments", `select=id&id=eq.${commerceAssignmentId}`)).toEqual([]);
      const codeRows = await harness.serviceRows(
        "delivery_confirmation_codes",
        `select=assignment_id,code_salt,code_hash,attempts,locked_until,verified_at&assignment_id=eq.${assignmentId}`,
      );
      expect(codeRows).toHaveLength(1);
      harness.track("delivery_confirmation_codes", assignmentId);
      expect(String(codeRows[0].code_salt).length).toBeGreaterThanOrEqual(32);
      expect(String(codeRows[0].code_hash)).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(codeRows)).not.toContain(firstDeliveryCode);

      await harness.rpc(
        "transition_fulfillment_order",
        { p_fulfillment_id: fulfillmentId, p_status: "preparing", p_note: E2E_RUN_ID },
        { token: users.provider.accessToken },
      );
      await harness.rpc(
        "transition_fulfillment_order",
        { p_fulfillment_id: fulfillmentId, p_status: "ready", p_note: E2E_RUN_ID },
        { token: users.provider.accessToken },
      );
      const assigned = await harness.rpc(
        "assign_delivery_driver",
        { p_fulfillment_id: fulfillmentId, p_driver_id: driverId },
        { token: users.provider.accessToken },
      );
      expect(String(assigned.data)).toBe(assignmentId);
      const invalidTransition = await harness.rpc(
        "transition_delivery_assignment",
        { p_assignment_id: assignmentId, p_status: "arrived", p_note: E2E_RUN_ID },
        { token: users.driver.accessToken, allow: [400] },
      );
      expect(invalidTransition.ok).toBeFalsy();
      for (const status of ["picked_up", "in_transit", "arrived"]) {
        await harness.rpc(
          "transition_delivery_assignment",
          { p_assignment_id: assignmentId, p_status: status, p_note: E2E_RUN_ID },
          { token: users.driver.accessToken },
        );
      }

      const wrongCode = firstDeliveryCode === "000000" ? "111111" : "000000";
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const wrong = await harness.rpc(
          "confirm_delivery_code",
          { p_assignment_id: assignmentId, p_plain_code: wrongCode },
          { token: users.driver.accessToken },
        );
        expect(wrong.data).toBe(false);
      }
      const locked = await harness.serviceRows(
        "delivery_confirmation_codes",
        `select=attempts,max_attempts,locked_until&assignment_id=eq.${assignmentId}`,
      );
      expect(locked[0].attempts).toBe(locked[0].max_attempts);
      expect(locked[0].locked_until).not.toBeNull();
      const oldWhileLocked = await harness.rpc(
        "confirm_delivery_code",
        { p_assignment_id: assignmentId, p_plain_code: firstDeliveryCode },
        { token: users.driver.accessToken },
      );
      expect(oldWhileLocked.data).toBe(false);

      const adminContext = await browser.newContext();
      const adminPage = await adminContext.newPage();
      await loginAs(adminPage, users.admin);
      const reissued = await adminPage.evaluate(async (id) => {
        const response = await fetch(`/api/admin/deliveries/${id}/reissue-code`, { method: "POST" });
        return { status: response.status, body: await response.json() };
      }, assignmentId);
      expect(reissued.status).toBe(200);
      await adminContext.close();
      const newDeliveryCode = providerMock.calls.deliveryCodes.at(-1)!;
      expect(newDeliveryCode).not.toBe(firstDeliveryCode);
      const oldAfterReissue = await harness.rpc(
        "confirm_delivery_code",
        { p_assignment_id: assignmentId, p_plain_code: firstDeliveryCode },
        { token: users.driver.accessToken },
      );
      expect(oldAfterReissue.data).toBe(false);
      const confirmed = await harness.rpc(
        "confirm_delivery_code",
        { p_assignment_id: assignmentId, p_plain_code: newDeliveryCode },
        { token: users.driver.accessToken },
      );
      expect(confirmed.data).toBe(true);
      const duplicateConfirmation = await harness.rpc(
        "confirm_delivery_code",
        { p_assignment_id: assignmentId, p_plain_code: newDeliveryCode },
        { token: users.driver.accessToken },
      );
      expect(duplicateConfirmation.data).toBe(false);
      const delivered = await harness.serviceRows("provider_delivery_assignments", `select=status&id=eq.${assignmentId}`);
      const deliveredOrder = await harness.serviceRows("orders", `select=status&id=eq.${orderId}`);
      expect(delivered[0].status).toBe("delivered");
      expect(deliveredOrder[0].status).toBe("delivered");
    });

    await test.step("contractor services and portfolio review workflows", async () => {
      const servicePayload = {
        title: `${E2E_RUN_ID}-service`,
        description: `${E2E_RUN_ID} contractor service description`,
        specialty: `${E2E_RUN_ID}-specialty`,
        pricing_method: "project",
        minimum_price: 100,
        maximum_price: 500,
        estimated_duration: "5 days",
        is_active: true,
      };
      const draft = await harness.rpc(
        "save_contractor_service",
        { p_id: null, p_service: servicePayload, p_regions: ["Riyadh"], p_submit: false },
        { token: users.contractor.accessToken },
      );
      const serviceId = String(draft.data);
      contractorServiceId = serviceId;
      harness.track("contractor_services", serviceId);
      await harness.rpc(
        "save_contractor_service",
        { p_id: serviceId, p_service: { ...servicePayload, description: `${servicePayload.description} updated` }, p_regions: ["Riyadh"], p_submit: true },
        { token: users.contractor.accessToken },
      );
      await harness.rpc(
        "review_contractor_catalog_item",
        { p_kind: "service", p_id: serviceId, p_decision: "needs_changes", p_notes: `${E2E_RUN_ID} revise service` },
        { token: users.admin.accessToken },
      );
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      await harness.rpc(
        "save_contractor_service",
        { p_id: serviceId, p_service: { ...servicePayload, description: `${servicePayload.description} revised` }, p_regions: ["Riyadh"], p_submit: true },
        { token: users.contractor.accessToken },
      );
      await harness.rpc(
        "review_contractor_catalog_item",
        { p_kind: "service", p_id: serviceId, p_decision: "approved", p_notes: `${E2E_RUN_ID} approved service` },
        { token: users.admin.accessToken },
      );
      expect(await harness.update(
        "contractor_services",
        `id=eq.${contractorServiceId}`,
        { description: "unauthorized peer contractor edit" },
        { token: rlsPeer.accessToken },
      )).toEqual([]);
      const rejectedService = await harness.rpc(
        "save_contractor_service",
        { p_id: null, p_service: { ...servicePayload, title: `rejected-${E2E_RUN_ID}-service` }, p_regions: ["Riyadh"], p_submit: true },
        { token: users.contractor.accessToken },
      );
      const rejectedServiceId = String(rejectedService.data);
      harness.track("contractor_services", rejectedServiceId);
      await harness.rpc(
        "review_contractor_catalog_item",
        { p_kind: "service", p_id: rejectedServiceId, p_decision: "rejected", p_notes: `${E2E_RUN_ID} rejected service` },
        { token: users.admin.accessToken },
      );
      const publicServices = await harness.userRows(
        users.customer,
        "contractor_services",
        `select=id,review_status&id=in.(${serviceId},${rejectedServiceId})`,
      );
      expect(publicServices.map((row) => row.id)).toEqual([serviceId]);
      const unauthorizedServiceEdit = await harness.update(
        "contractor_services",
        `id=eq.${serviceId}`,
        { description: "unauthorized provider edit" },
        { token: users.provider.accessToken },
      );
      expect(unauthorizedServiceEdit).toEqual([]);

      const portfolioPayload = {
        title: `${E2E_RUN_ID}-portfolio`,
        description: `${E2E_RUN_ID} completed portfolio project`,
        project_type: "construction",
        completion_date: new Date().toISOString().slice(0, 10),
        city: "Riyadh",
        region: "Riyadh",
        visibility: true,
        sort_order: 1,
      };
      const portfolioDraft = await harness.rpc(
        "save_contractor_portfolio_item",
        { p_id: null, p_item: portfolioPayload, p_submit: false },
        { token: users.contractor.accessToken },
      );
      const portfolioId = String(portfolioDraft.data);
      harness.track("contractor_portfolio_items", portfolioId);
      const mediaPath = `${contractorId}/${E2E_RUN_ID}.png`;
      const onePixelPng = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=", "base64"));
      await harness.uploadStorage(users.contractor, "contractor-portfolio", mediaPath, onePixelPng, "image/png");
      const signed = await harness.createSignedUrl(users.contractor, "contractor-portfolio", mediaPath);
      expect(signed).toContain("token=");
      const mediaRows = await harness.insert("contractor_portfolio_media", {
        portfolio_item_id: portfolioId,
        storage_path: mediaPath,
        file_name: `${E2E_RUN_ID}.png`,
        mime_type: "image/png",
        size_bytes: onePixelPng.byteLength,
        is_primary: false,
        sort_order: 0,
      }, { token: users.contractor.accessToken });
      const mediaId = String(mediaRows[0].id);
      harness.track("contractor_portfolio_media", mediaId);
      await harness.rpc(
        "set_contractor_portfolio_primary_media",
        { p_item_id: portfolioId, p_media_id: mediaId },
        { token: users.contractor.accessToken },
      );
      await harness.rpc(
        "save_contractor_portfolio_item",
        { p_id: portfolioId, p_item: portfolioPayload, p_submit: true },
        { token: users.contractor.accessToken },
      );
      await harness.rpc(
        "review_contractor_catalog_item",
        { p_kind: "portfolio", p_id: portfolioId, p_decision: "needs_changes", p_notes: `${E2E_RUN_ID} revise portfolio` },
        { token: users.admin.accessToken },
      );
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      await harness.rpc(
        "save_contractor_portfolio_item",
        { p_id: portfolioId, p_item: { ...portfolioPayload, description: `${portfolioPayload.description} revised` }, p_submit: true },
        { token: users.contractor.accessToken },
      );
      await harness.rpc(
        "review_contractor_catalog_item",
        { p_kind: "portfolio", p_id: portfolioId, p_decision: "approved", p_notes: `${E2E_RUN_ID} approved portfolio` },
        { token: users.admin.accessToken },
      );
      const publicPortfolio = await harness.userRows(users.customer, "contractor_portfolio_items", `select=id,review_status&id=eq.${portfolioId}`);
      if (publicPortfolio.length !== 1) blockers.push("contractor portfolio public RLS policy is blocked; migration 014 is not applied");
      const unauthorizedPortfolioEdit = await harness.update(
        "contractor_portfolio_items",
        `id=eq.${portfolioId}`,
        { description: "unauthorized provider edit" },
        { token: users.provider.accessToken },
      );
      expect(unauthorizedPortfolioEdit).toEqual([]);
    });

    await test.step("contractor opportunities, proposals, projects and milestones", async () => {
      const projectRequest = {
        title: `${E2E_RUN_ID}-project`,
        project_type: "construction",
        description: `${E2E_RUN_ID} customer project description`,
        scope: `${E2E_RUN_ID} customer project scope`,
        city: "Riyadh",
        region: "Riyadh",
        quantity_label: "one project",
        budget_min: 1000,
        budget_max: 5000,
        expected_start_at: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
        estimated_duration: "10 days",
        proposal_deadline_at: new Date(Date.now() + 48 * 3_600_000).toISOString(),
        minimum_rating: 0,
        terms: [E2E_RUN_ID],
        budget_negotiable: true,
        duration_value: 10,
        duration_unit: "day",
        location_name: "Riyadh",
        access_description: E2E_RUN_ID,
        technical_details: { e2e_run_id: E2E_RUN_ID },
      };
      const submitted = await harness.rpc(
        "submit_customer_project_request",
        { p_request: projectRequest, p_specialties: [`${E2E_RUN_ID}-specialty`], p_idempotency_key: `${E2E_RUN_ID}-project-request` },
        { token: users.customer.accessToken, allow: [400] },
      );
      let requestId = "";
      if (submitted.ok) {
        requestId = String(submitted.data);
      } else {
        blockers.push("submit_customer_project_request enum assignment is blocked; migration 015 is not applied");
        const requestRows = await harness.insert("project_requests", {
          request_code: `PRJ-E2E-${Date.now()}`,
          customer_profile_id: users.customer.id,
          title: projectRequest.title,
          project_type: projectRequest.project_type,
          description: projectRequest.description,
          scope: projectRequest.scope,
          city: projectRequest.city,
          region: projectRequest.region,
          quantity_label: projectRequest.quantity_label,
          estimated_budget_min: projectRequest.budget_min,
          estimated_budget_max: projectRequest.budget_max,
          expected_start_at: projectRequest.expected_start_at,
          estimated_duration: projectRequest.estimated_duration,
          proposal_deadline_at: projectRequest.proposal_deadline_at,
          minimum_rating: projectRequest.minimum_rating,
          customer_label: "E2E customer",
          terms: projectRequest.terms,
          is_open: true,
          lifecycle_status: "receiving_proposals",
          submitted_at: new Date().toISOString(),
          published_at: new Date().toISOString(),
          budget_negotiable: true,
          duration_value: 10,
          duration_unit: "day",
          location_name: "Riyadh",
          access_description: E2E_RUN_ID,
          technical_details: { e2e_run_id: E2E_RUN_ID },
        });
        requestId = String(requestRows[0].id);
        await harness.insert("project_request_specialties", { project_request_id: requestId, specialty_name: `${E2E_RUN_ID}-specialty` });
        const opportunityRows = await harness.insert("contractor_opportunities", { project_request_id: requestId, contractor_profile_id: contractorId, status: "new", expires_at: projectRequest.proposal_deadline_at });
        harness.track("contractor_opportunities", String(opportunityRows[0].id));
      }
      harness.track("project_requests", requestId);
      if (submitted.ok) {
        const duplicate = await harness.rpc(
          "submit_customer_project_request",
          { p_request: projectRequest, p_specialties: [`${E2E_RUN_ID}-specialty`], p_idempotency_key: `${E2E_RUN_ID}-project-request` },
          { token: users.customer.accessToken },
        );
        expect(String(duplicate.data)).toBe(requestId);
      }
      const opportunities = await harness.serviceRows("contractor_opportunities", `select=id&project_request_id=eq.${requestId}&contractor_profile_id=eq.${contractorId}`);
      expect(opportunities).toHaveLength(1);
      const opportunityId = String(opportunities[0].id);
      harness.track("contractor_opportunities", opportunityId);
      const privateProjection = await harness.rpc("get_contractor_opportunities", {}, { token: users.contractor.accessToken });
      expect(JSON.stringify(privateProjection.data)).not.toContain(users.customer.email);
      expect(JSON.stringify(privateProjection.data)).not.toContain(users.customer.phone);

      const stages = [
        { name: "phase-1", description: E2E_RUN_ID, duration: "5 days", value_percentage: 50, expected_at: new Date(Date.now() + 15 * 86_400_000).toISOString().slice(0, 10), sort_order: 0 },
        { name: "phase-2", description: E2E_RUN_ID, duration: "5 days", value_percentage: 50, expected_at: new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10), sort_order: 1 },
      ];
      const proposalPayload = {
        amount: 3000,
        vat_inclusive: false,
        execution_duration: "10 days",
        proposed_start_at: projectRequest.expected_start_at,
        scope_details: `${E2E_RUN_ID} proposal scope`,
        includes: ["materials"],
        excludes: ["permits"],
        valid_until: new Date(Date.now() + 36 * 3_600_000).toISOString(),
        warranty: "one year",
        team: "E2E team",
        notes: E2E_RUN_ID,
        policy_accepted: true,
      };
      const proposal = await harness.rpc(
        "save_contractor_proposal",
        { p_opportunity_id: opportunityId, p_proposal: proposalPayload, p_stages: stages, p_submit: true, p_idempotency_key: `${E2E_RUN_ID}-proposal` },
        { token: users.contractor.accessToken },
      );
      const proposalId = String(proposal.data);
      harness.track("contractor_proposals", proposalId);
      await harness.rpc(
        "decide_contractor_proposal",
        { p_proposal_id: proposalId, p_decision: "needs_changes", p_reason: `${E2E_RUN_ID} revise proposal`, p_idempotency_key: `${E2E_RUN_ID}-proposal-needs` },
        { token: users.customer.accessToken },
      );
      const resubmitted = await harness.rpc(
        "save_contractor_proposal",
        { p_opportunity_id: opportunityId, p_proposal: { ...proposalPayload, amount: 2900 }, p_stages: stages, p_submit: true, p_idempotency_key: `${E2E_RUN_ID}-proposal-resubmit` },
        { token: users.contractor.accessToken, allow: [409] },
      );
      if (!resubmitted.ok) {
        blockers.push("contractor proposal resubmit outbox idempotency collision; migration 016 is not applied");
        await harness.update("contractor_proposals", `id=eq.${proposalId}`, { amount: 2900, status: "under_review", submitted_at: new Date().toISOString() });
        const oldStages = await harness.serviceRows("contractor_proposal_stages", `select=id&proposal_id=eq.${proposalId}`);
        await harness.deleteExact("contractor_proposal_stages", "id", oldStages.map((row) => String(row.id)));
        for (const stage of stages) {
          const rows = await harness.insert("contractor_proposal_stages", { proposal_id: proposalId, ...stage });
          harness.track("contractor_proposal_stages", String(rows[0].id));
        }
      }
      const accepted = await harness.rpc(
        "decide_contractor_proposal",
        { p_proposal_id: proposalId, p_decision: "accepted", p_reason: `${E2E_RUN_ID} accept proposal`, p_idempotency_key: `${E2E_RUN_ID}-proposal-accept` },
        { token: users.customer.accessToken, allow: [400] },
      );
      if (accepted.ok) {
        contractorProjectId = String(accepted.data);
      } else {
        blockers.push("contractor proposal acceptance runtime blocker on remote schema");
        const projectRows = await harness.insert("contractor_projects", {
          project_code: `CTR-E2E-${Date.now()}`,
          accepted_proposal_id: proposalId,
          contractor_profile_id: contractorId,
          customer_profile_id: users.customer.id,
          name: projectRequest.title,
          customer_label: "E2E customer",
          project_value: 2900,
          start_at: projectRequest.expected_start_at,
          expected_end_at: new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10),
          scope: projectRequest.scope,
          status: "awaiting_start",
        });
        contractorProjectId = String(projectRows[0].id);
        for (const stage of stages) {
          const rows = await harness.insert("contractor_project_milestones", {
            project_id: contractorProjectId,
            name: stage.name,
            description: stage.description,
            start_at: projectRequest.expected_start_at,
            expected_end_at: stage.expected_at,
            value_percentage: stage.value_percentage,
            status: "not_started",
            sort_order: stage.sort_order,
          });
          harness.track("contractor_project_milestones", String(rows[0].id));
        }
      }
      harness.track("contractor_projects", contractorProjectId);
      if (accepted.ok) {
        const duplicateAccept = await harness.rpc(
          "decide_contractor_proposal",
          { p_proposal_id: proposalId, p_decision: "accepted", p_reason: `${E2E_RUN_ID} accept proposal`, p_idempotency_key: `${E2E_RUN_ID}-proposal-accept` },
          { token: users.customer.accessToken, allow: [400] },
        );
        expect(duplicateAccept.ok).toBeFalsy();
      }
      const milestones = await harness.serviceRows("contractor_project_milestones", `select=id,status,sort_order&project_id=eq.${contractorProjectId}&order=sort_order.asc`);
      expect(milestones).toHaveLength(2);
      for (const row of milestones) harness.track("contractor_project_milestones", String(row.id));
      const early = await harness.rpc(
        "transition_contractor_milestone",
        { p_milestone_id: milestones[1].id, p_action: "start", p_note: E2E_RUN_ID },
        { token: users.contractor.accessToken, allow: [400] },
      );
      expect(early.ok).toBeFalsy();
      for (const milestone of milestones) {
        await harness.rpc("transition_contractor_milestone", { p_milestone_id: milestone.id, p_action: "start", p_note: E2E_RUN_ID }, { token: users.contractor.accessToken });
        await harness.rpc("transition_contractor_milestone", { p_milestone_id: milestone.id, p_action: "submit", p_note: E2E_RUN_ID }, { token: users.contractor.accessToken });
        await harness.rpc("transition_contractor_milestone", { p_milestone_id: milestone.id, p_action: "approve", p_note: E2E_RUN_ID }, { token: users.customer.accessToken });
      }
      const completedProject = await harness.serviceRows("contractor_projects", `select=status,progress&id=eq.${contractorProjectId}`);
      expect(completedProject[0].status).toBe("completed");
      expect(Number(completedProject[0].progress)).toBe(100);
      const providerProjectAccess = await harness.userRows(users.provider, "contractor_projects", `select=id&id=eq.${contractorProjectId}`);
      expect(providerProjectAccess).toEqual([]);
      expect(await harness.update(
        "contractor_projects",
        `id=eq.${contractorProjectId}`,
        { notes: "unauthorized peer contractor edit" },
        { token: rlsPeer.accessToken },
      )).toEqual([]);
    });

    await test.step("support, finance and settlement state machines", async () => {
      const ticket = await harness.rpc(
        "create_support_ticket",
        { p_data: { requester_role: "customer", subject: `${E2E_RUN_ID} support`, description: `${E2E_RUN_ID} connected support request`, category: "general", priority: "normal" }, p_idempotency_key: `${E2E_RUN_ID}-support-customer` },
        { token: users.customer.accessToken },
      );
      const ticketId = String(ticket.data);
      harness.track("support_tickets", ticketId);
      const duplicateTicket = await harness.rpc(
        "create_support_ticket",
        { p_data: { requester_role: "customer", subject: `${E2E_RUN_ID} support`, description: `${E2E_RUN_ID} connected support request`, category: "general", priority: "normal" }, p_idempotency_key: `${E2E_RUN_ID}-support-customer` },
        { token: users.customer.accessToken },
      );
      expect(String(duplicateTicket.data)).toBe(ticketId);
      await harness.rpc("transition_support_ticket", { p_ticket: ticketId, p_action: "assign", p_reason: E2E_RUN_ID, p_assignee: users.admin.id }, { token: users.admin.accessToken });
      const internalReply = await harness.rpc("reply_support_ticket", { p_ticket: ticketId, p_body: `${E2E_RUN_ID} internal note`, p_internal: true, p_idempotency_key: `${E2E_RUN_ID}-internal` }, { token: users.admin.accessToken });
      const externalReply = await harness.rpc("reply_support_ticket", { p_ticket: ticketId, p_body: `${E2E_RUN_ID} external reply`, p_internal: false, p_idempotency_key: `${E2E_RUN_ID}-external` }, { token: users.admin.accessToken });
      harness.track("support_messages", String(internalReply.data));
      harness.track("support_messages", String(externalReply.data));
      const customerMessages = await harness.userRows(users.customer, "support_messages", `select=id,is_internal&ticket_id=eq.${ticketId}`);
      expect(customerMessages.some((row) => row.is_internal === true)).toBeFalsy();
      await harness.rpc("transition_support_ticket", { p_ticket: ticketId, p_action: "resolve", p_reason: E2E_RUN_ID, p_assignee: null }, { token: users.admin.accessToken });
      await harness.rpc("transition_support_ticket", { p_ticket: ticketId, p_action: "reopen", p_reason: E2E_RUN_ID, p_assignee: null }, { token: users.customer.accessToken });

      for (const role of ["provider", "contractor"] as const) {
        const smoke = await harness.rpc(
          "create_support_ticket",
          { p_data: { requester_role: role, subject: `${E2E_RUN_ID} ${role} support`, description: `${E2E_RUN_ID} ${role} support smoke request`, category: "general", priority: "normal" }, p_idempotency_key: `${E2E_RUN_ID}-support-${role}` },
          { token: users[role].accessToken },
        );
        harness.track("support_tickets", String(smoke.data));
      }
      const peerTicket = await harness.rpc(
        "create_support_ticket",
        { p_data: { requester_role: "provider", subject: `${E2E_RUN_ID} peer support`, description: `${E2E_RUN_ID} peer support RLS fixture`, category: "general", priority: "normal" }, p_idempotency_key: `${E2E_RUN_ID}-support-peer` },
        { token: rlsPeer.accessToken },
      );
      const peerTicketId = String(peerTicket.data);
      harness.track("support_tickets", peerTicketId);
      expect(await harness.userRows(users.customer, "support_tickets", `select=id&id=eq.${peerTicketId}`)).toEqual([]);

      expect(contractorProjectId).toMatch(/^[0-9a-f-]{36}$/i);
      const financialRows = await harness.insert("contractor_financial_transactions", {
        transaction_code: `E2E-${Date.now()}`,
        contractor_profile_id: contractorId,
        project_id: contractorProjectId,
        transaction_type: "milestone_payment",
        financial_kind: "milestone_payment",
        amount: 1000,
        status: "available",
        balance_after: 1000,
        reference: E2E_RUN_ID,
        metadata: { e2e_run_id: E2E_RUN_ID },
      });
      const financialId = String(financialRows[0].id);
      harness.track("contractor_financial_transactions", financialId);
      const bank = await harness.rpc(
        "save_contractor_bank_account",
        { p_id: null, p_bank: "E2E Bank", p_name: E2E_RUN_ID, p_iban: "SA0000000000000000000000", p_default: true },
        { token: users.contractor.accessToken },
      );
      const bankId = String(bank.data);
      harness.track("contractor_bank_accounts", bankId);
      const bankView = await harness.userRows(users.contractor, "contractor_bank_accounts", `select=id,iban_last4,iban_encrypted&id=eq.${bankId}`);
      expect(bankView[0].iban_last4).toBe("0000");
      expect(String(bankView[0].iban_encrypted)).not.toContain("SA0000");
      const rejectedSettlement = await harness.rpc("request_contractor_settlement", { p_amount: 100, p_bank: bankId, p_notes: E2E_RUN_ID, p_idempotency_key: `${E2E_RUN_ID}-settlement-reject` }, { token: users.contractor.accessToken });
      const rejectedSettlementId = String(rejectedSettlement.data);
      harness.track("contractor_settlement_requests", rejectedSettlementId);
      await harness.rpc("transition_contractor_settlement", { p_id: rejectedSettlementId, p_action: "reject", p_reason: `${E2E_RUN_ID} reject`, p_reference: "", p_idempotency_key: `${E2E_RUN_ID}-reject-state` }, { token: users.admin.accessToken });
      const paidSettlement = await harness.rpc("request_contractor_settlement", { p_amount: 200, p_bank: bankId, p_notes: E2E_RUN_ID, p_idempotency_key: `${E2E_RUN_ID}-settlement-paid` }, { token: users.contractor.accessToken });
      const paidSettlementId = String(paidSettlement.data);
      harness.track("contractor_settlement_requests", paidSettlementId);
      for (const action of ["review", "approve", "process", "paid"]) {
        await harness.rpc(
          "transition_contractor_settlement",
          { p_id: paidSettlementId, p_action: action, p_reason: `${E2E_RUN_ID} ${action}`, p_reference: action === "paid" ? `${E2E_RUN_ID}-reference` : "", p_idempotency_key: `${E2E_RUN_ID}-${action}` },
          { token: users.admin.accessToken },
        );
      }
      const paidState = await harness.serviceRows("contractor_settlement_requests", `select=workflow_status,payment_reference&id=eq.${paidSettlementId}`);
      expect(paidState[0].workflow_status).toBe("paid");
      const immutable = await harness.request(`/rest/v1/contractor_financial_transactions?id=eq.${financialId}`, { method: "PATCH", service: true, body: { amount: 9999 }, allow: [400] });
      expect(immutable.ok).toBeFalsy();
      const unauthorizedSettlement = await harness.userRows(users.customer, "contractor_settlement_requests", `select=id&id=eq.${paidSettlementId}`);
      expect(unauthorizedSettlement).toEqual([]);
      const generatedFinancial = await harness.serviceRows("contractor_financial_transactions", `select=id&reference=eq.${E2E_RUN_ID}-reference`);
      for (const row of generatedFinancial) harness.track("contractor_financial_transactions", String(row.id));
    });

    await test.step("notification routing, idempotency, retry policy and dead-letter", async () => {
      await harness.update("outbox_events", "status=in.(pending,failed)", { available_at: new Date(Date.now() + 86_400_000).toISOString(), next_attempt_at: new Date(Date.now() + 86_400_000).toISOString() });
      async function createNotificationEvent(label: string) {
        const aggregateId = randomUUID();
        const rows = await harness.insert("outbox_events", {
          aggregate_type: "contractor_service",
          aggregate_id: aggregateId,
          event_type: "contractor.service_approved",
          payload: { contractor_id: contractorId, notes: `${label} notification validation` },
          idempotency_key: `${E2E_RUN_ID}-notification-${label}`,
        });
        const id = String(rows[0].id);
        harness.track("outbox_events", id);
        return { id, aggregateId };
      }

      async function dispatchNotifications() {
        const response = await fetch("http://127.0.0.1:3100/api/cron/notifications", {
          headers: { authorization: `Bearer ${String(process.env.CRON_SECRET)}` },
        });
        expect(response.status).toBe(200);
        return response.json() as Promise<{ claimed: number; processed: number; failed: number }>;
      }

      async function trackArtifacts(event: { id: string; aggregateId: string }) {
        const notifications = await harness.serviceRows("notifications", `select=id,profile_id,message,action_url,event_key&entity_id=eq.${event.aggregateId}`);
        for (const row of notifications) harness.track("notifications", String(row.id));
        const submissions = await harness.serviceRows("notification_provider_submissions", `select=id,channel,status,idempotency_key,sanitized_error&idempotency_key=like.outbox-${event.id}-*`);
        for (const row of submissions) harness.track("notification_provider_submissions", String(row.id));
        return { notifications, submissions };
      }

      const existingPending = await harness.serviceRows("outbox_events", "select=id,aggregate_id,status&status=eq.pending");
      const trackedAggregateIds = new Set([...harness.ids.values()].flatMap((values) => [...values]));
      for (const row of existingPending) {
        if (trackedAggregateIds.has(String(row.aggregate_id))) harness.track("outbox_events", String(row.id));
      }
      for (let batch = 0; batch < 20; batch += 1) {
        const trackedOutboxIds = [...(harness.ids.get("outbox_events") || [])];
        if (!trackedOutboxIds.length) break;
        const pending = await harness.serviceRows("outbox_events", `select=id,aggregate_id&status=eq.pending&id=in.(${trackedOutboxIds.join(",")})&limit=25`);
        if (!pending.length) break;
        await dispatchNotifications();
      }

      const resendBeforeOperational = providerMock.calls.resend;
      const success = await createNotificationEvent("success");
      const successDispatch = await dispatchNotifications();
      expect(successDispatch.processed).toBeGreaterThan(0);
      const successArtifacts = await trackArtifacts(success);
      if (successArtifacts.notifications.length !== 1) {
        blockers.push("notification recipient persistence missing for processed event");
      } else {
        expect(successArtifacts.notifications[0]).toMatchObject({ profile_id: users.contractor.id, action_url: "/contractor/services" });
        expect(String(successArtifacts.notifications[0].message).length).toBeGreaterThan(20);
      }
      expect(successArtifacts.submissions).toHaveLength(1);
      expect(successArtifacts.submissions[0]).toMatchObject({ channel: "whatsapp", status: "submitted", sanitized_error: null });
      await dispatchNotifications();
      const duplicateArtifacts = await trackArtifacts(success);
      expect(duplicateArtifacts.notifications.length).toBe(successArtifacts.notifications.length);
      expect(duplicateArtifacts.submissions).toHaveLength(1);
      expect(providerMock.calls.resend).toBe(resendBeforeOperational);

      const badRequest = await createNotificationEvent("force-400");
      providerMock.calls.mode = 400;
      await dispatchNotifications();
      providerMock.calls.mode = null;
      const badRequestKey = `outbox-${badRequest.id}-${users.contractor.id}`;
      expect(providerMock.calls.byKey.get(badRequestKey)).toBe(1);
      expect((await harness.serviceRows("outbox_events", `select=status,attempts&id=eq.${badRequest.id}`))[0]).toMatchObject({ status: "failed", attempts: 1 });
      await trackArtifacts(badRequest);

      const throttled = await createNotificationEvent("force-429");
      providerMock.calls.mode = 429;
      await dispatchNotifications();
      providerMock.calls.mode = null;
      const throttledKey = `outbox-${throttled.id}-${users.contractor.id}`;
      expect(providerMock.calls.byKey.get(throttledKey)).toBe(3);
      expect((await harness.serviceRows("outbox_events", `select=status,attempts&id=eq.${throttled.id}`))[0]).toMatchObject({ status: "failed", attempts: 1 });
      await trackArtifacts(throttled);

      const serverError = await createNotificationEvent("force-500");
      const serverErrorKey = `outbox-${serverError.id}-${users.contractor.id}`;
      providerMock.calls.mode = 500;
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        if (attempt > 1) await harness.update("outbox_events", `id=eq.${serverError.id}`, { status: "failed", next_attempt_at: new Date(0).toISOString() });
        await dispatchNotifications();
      }
      providerMock.calls.mode = null;
      expect(providerMock.calls.byKey.get(serverErrorKey)).toBe(15);
      expect((await harness.serviceRows("outbox_events", `select=status,attempts,dead_letter_at&id=eq.${serverError.id}`))[0]).toMatchObject({ status: "dead_letter", attempts: 5 });
      const deadLetterAlerts = await harness.serviceRows("outbox_events", `select=id,event_type&idempotency_key=eq.dead-letter-alert:${serverError.id}`);
      expect(deadLetterAlerts).toHaveLength(1);
      harness.track("outbox_events", String(deadLetterAlerts[0].id));
      await trackArtifacts(serverError);
    });

    async function createCommerceQuote(suffix: string, product: Record<string, unknown>) {
      const requested = await harness.rpc(
        "submit_customer_rfq",
        {
          p_request: {
            city: "Riyadh",
            location_hint: `${E2E_RUN_ID}-${suffix}`,
            desired_receipt_at: new Date(Date.now() + 48 * 3_600_000).toISOString(),
            delivery_mode: "delivery",
            project_name: `${E2E_RUN_ID}-${suffix}`,
            recipient_name: `${E2E_RUN_ID}-customer`,
            recipient_mobile: users.customer.phone,
            notes: E2E_RUN_ID,
          },
          p_items: [{
            product_id: product.id,
            quantity: 2,
            unit: product.base_unit,
            measurement: "",
            unit_id: "",
            measurement_id: "",
            notes: E2E_RUN_ID,
          }],
          p_idempotency_key: `${E2E_RUN_ID}-rfq-${suffix}`,
        },
        { token: users.customer.accessToken, allow: [400] },
      );
      if (!requested.ok) {
        const code = (requested.data as { code?: string } | null)?.code || "unknown";
        blockers.push(`submit_customer_rfq remote blocker (${code}); migration 011 is not applied`);
        return null;
      }
      const requestId = String(requested.data);
      harness.track("quote_requests", requestId);
      const quoteItems = await harness.serviceRows("quote_request_items", `select=id&request_id=eq.${requestId}`);
      expect(quoteItems).toHaveLength(1);
      harness.track("quote_request_items", String(quoteItems[0].id));
      const sources = await harness.serviceRows("internal_sourcing_requests", `select=id,stage&customer_request_id=eq.${requestId}`);
      expect(sources).toHaveLength(1);
      const sourcingRequestId = String(sources[0].id);
      harness.track("internal_sourcing_requests", sourcingRequestId);
      const sourcingItems = await harness.serviceRows(
        "internal_sourcing_request_items",
        `select=id&sourcing_request_id=eq.${sourcingRequestId}`,
      );
      expect(sourcingItems).toHaveLength(1);
      const sourcingItemId = String(sourcingItems[0].id);
      harness.track("internal_sourcing_request_items", sourcingItemId);
      const targets = await harness.serviceRows(
        "internal_sourcing_request_targets",
        `select=sourcing_request_item_id,provider_id&sourcing_request_item_id=eq.${sourcingItemId}&provider_id=eq.${providerId}`,
      );
      expect(targets).toHaveLength(1);
      const response = await harness.rpc(
        "submit_provider_pricing_response",
        {
          p_sourcing_item_id: sourcingItemId,
          p_response: {
            available: true,
            available_quantity: 2,
            unit_price: 100,
            vat_inclusive: false,
            preparation_hours: 2,
            delivery_hours: 4,
            delivery_fee: 20,
            region_eligible: true,
            price_expires_at: new Date(Date.now() + 36 * 3_600_000).toISOString(),
            notes: E2E_RUN_ID,
          },
        },
        { token: users.provider.accessToken },
      );
      const responseId = String(response.data);
      harness.track("provider_pricing_responses", responseId);
      const confirmations = await Promise.all([
        harness.serviceRows("provider_availability_confirmations", `select=id&pricing_response_id=eq.${responseId}`),
        harness.serviceRows("provider_delivery_confirmations", `select=id&pricing_response_id=eq.${responseId}`),
      ]);
      expect(confirmations[0]).toHaveLength(1);
      expect(confirmations[1]).toHaveLength(1);
      harness.track("provider_availability_confirmations", String(confirmations[0][0].id));
      harness.track("provider_delivery_confirmations", String(confirmations[1][0].id));
      const duplicate = await harness.rpc(
        "submit_provider_pricing_response",
        {
          p_sourcing_item_id: sourcingItemId,
          p_response: {
            available: true,
            available_quantity: 2,
            unit_price: 101,
            vat_inclusive: false,
            preparation_hours: 2,
            delivery_hours: 4,
            delivery_fee: 20,
            region_eligible: true,
            price_expires_at: new Date(Date.now() + 36 * 3_600_000).toISOString(),
            notes: E2E_RUN_ID,
          },
        },
        { token: users.provider.accessToken, allow: [400] },
      );
      expect(duplicate.ok).toBeFalsy();
      const assembled = await harness.rpc(
        "assemble_bunya_customer_quote",
        { p_sourcing_request_id: sourcingRequestId },
        { token: users.admin.accessToken },
      );
      const quoteId = String(assembled.data || "");
      expect(quoteId).toMatch(/^[0-9a-f-]{36}$/i);
      harness.track("bunya_customer_quotes", quoteId);
      const quoteRows = await harness.serviceRows(
        "bunya_customer_quotes",
        `select=id,subtotal,vat_amount,delivery_fee,total,status,valid_until,expected_delivery_at&id=eq.${quoteId}`,
      );
      expect(quoteRows).toHaveLength(1);
      expect(quoteRows[0].status).toBe("ready");
      const assembledItems = await harness.serviceRows("bunya_customer_quote_items", `select=id,line_total&bunya_customer_quote_id=eq.${quoteId}`);
      expect(assembledItems).toHaveLength(1);
      harness.track("bunya_customer_quote_items", String(assembledItems[0].id));
      expect(Number(assembledItems[0].line_total)).toBe(Number(quoteRows[0].total));
      const selections = await harness.serviceRows("internal_selection_results", `select=id&sourcing_request_id=eq.${sourcingRequestId}`);
      expect(selections).toHaveLength(1);
      harness.track("internal_selection_results", String(selections[0].id));
      const selectedItems = await harness.serviceRows("selected_provider_items", `select=id&selection_result_id=eq.${selections[0].id}`);
      expect(selectedItems).toHaveLength(1);
      harness.track("selected_provider_items", String(selectedItems[0].id));
      return { requestId, sourcingRequestId, sourcingItemId, responseId, quoteId };
    }
    expect(blockers, blockers.join("; ")).toEqual([]);
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    const cleanupFailures = await harness.cleanupE2EFixtures();
    await new Promise<void>((resolve) => providerMock.server.close(() => resolve()));
    if (!primaryFailure && cleanupFailures.length) throw new Error(`Connected E2E cleanup failed: ${cleanupFailures.join("; ")}`);
  }
});

function observe(page: Page, consoleErrors: string[], networkErrors: string[]) {
  page.on("console", (message) => {
    const text = message.text();
    const expectedDeniedRequest = text.includes("status of 403 (Forbidden)");
    if (message.type() === "error" && !text.includes("favicon") && !expectedDeniedRequest) consoleErrors.push(text);
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) networkErrors.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  page.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText || "unknown";
    if (!request.url().startsWith("data:") && !reason.includes("ERR_ABORTED")) {
      networkErrors.push(`FAILED ${new URL(request.url()).pathname} (${reason})`);
    }
  });
}
