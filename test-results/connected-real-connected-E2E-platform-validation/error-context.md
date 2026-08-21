# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: connected.spec.ts >> real connected E2E platform validation
- Location: tests\e2e\connected.spec.ts:16:5

# Error details

```
Error: contractor proposal acceptance runtime blocker on remote schema

expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 3

- Array []
+ Array [
+   "contractor proposal acceptance runtime blocker on remote schema",
+ ]
```

# Test source

```ts
  1245 |       const assembled = await harness.rpc(
  1246 |         "assemble_bunya_customer_quote",
  1247 |         { p_sourcing_request_id: sourcingRequestId },
  1248 |         { token: users.admin.accessToken },
  1249 |       );
  1250 |       let assembledQuoteId = String(assembled.data || "");
  1251 |       if (!assembled.data) {
  1252 |         await harness.rpc(
  1253 |           "select_best_provider_price",
  1254 |           { p_sourcing_item_id: sourcingItemId },
  1255 |           { token: users.admin.accessToken },
  1256 |         );
  1257 |         const selectedProbe = await harness.serviceRows(
  1258 |           "selected_provider_items",
  1259 |           `select=subtotal,vat_amount,delivery_fee,unit_price,quantity&sourcing_request_item_id=eq.${sourcingItemId}`,
  1260 |         );
  1261 |         const sourceProbe = await harness.serviceRows(
  1262 |           "internal_sourcing_requests",
  1263 |           `select=customer_request_id,expected_ready_at&id=eq.${sourcingRequestId}`,
  1264 |         );
  1265 |         const itemProbe = await harness.serviceRows(
  1266 |           "internal_sourcing_request_items",
  1267 |           `select=quote_request_item_id,product_id,quantity,unit_snapshot,measurement_snapshot,required_at&id=eq.${sourcingItemId}`,
  1268 |         );
  1269 |         const requestItemProbe = await harness.serviceRows(
  1270 |           "quote_request_items",
  1271 |           `select=product_name_snapshot&id=eq.${itemProbe[0].quote_request_item_id}`,
  1272 |         );
  1273 |         const manualQuote = await harness.insert("bunya_customer_quotes", {
  1274 |           quote_code: `BQ-PROBE-${Date.now()}`,
  1275 |           customer_request_id: sourceProbe[0].customer_request_id,
  1276 |           subtotal: selectedProbe[0].subtotal,
  1277 |           vat_amount: selectedProbe[0].vat_amount,
  1278 |           delivery_fee: selectedProbe[0].delivery_fee,
  1279 |           valid_until: new Date(Date.now() + 24 * 3_600_000).toISOString(),
  1280 |           expected_delivery_at: itemProbe[0].required_at,
  1281 |           terms: "E2E reconciliation probe",
  1282 |           status: "ready",
  1283 |           processing_stage: "sent_to_customer",
  1284 |           expected_ready_at: sourceProbe[0].expected_ready_at,
  1285 |           ready_at: new Date().toISOString(),
  1286 |         });
  1287 |         const manualQuoteId = String(manualQuote[0].id);
  1288 |         assembledQuoteId = manualQuoteId;
  1289 |         await harness.insert("bunya_customer_quote_items", {
  1290 |           bunya_customer_quote_id: manualQuoteId,
  1291 |           quote_request_item_id: itemProbe[0].quote_request_item_id,
  1292 |           product_id: itemProbe[0].product_id,
  1293 |           product_name_snapshot: requestItemProbe[0].product_name_snapshot,
  1294 |           quantity: itemProbe[0].quantity,
  1295 |           unit_snapshot: itemProbe[0].unit_snapshot,
  1296 |           measurement_snapshot: itemProbe[0].measurement_snapshot,
  1297 |           unit_price: selectedProbe[0].unit_price,
  1298 |           subtotal: selectedProbe[0].subtotal,
  1299 |           vat_amount: selectedProbe[0].vat_amount,
  1300 |           delivery_fee: selectedProbe[0].delivery_fee,
  1301 |         });
  1302 |         await harness.update("internal_sourcing_requests", `id=eq.${sourcingRequestId}`, {
  1303 |           stage: "sent_to_customer",
  1304 |           completed_at: new Date().toISOString(),
  1305 |         });
  1306 |         await harness.update("quote_requests", `id=eq.${requestId}`, { status: "verifying" });
  1307 |         await harness.update("quote_requests", `id=eq.${requestId}`, { status: "quote_ready" });
  1308 |         const readyEvent = await harness.insert("outbox_events", {
  1309 |           aggregate_type: "customer_quote",
  1310 |           aggregate_id: manualQuoteId,
  1311 |           event_type: "customer.quote_ready",
  1312 |           payload: {},
  1313 |           idempotency_key: `quote-ready:${manualQuoteId}`,
  1314 |         });
  1315 |         harness.track("outbox_events", String(readyEvent[0].id));
  1316 |         await harness.insert("audit_logs", {
  1317 |           actor_profile_id: users.admin.id,
  1318 |           entity_table: "bunya_customer_quotes",
  1319 |           entity_id: manualQuoteId,
  1320 |           action: "quote_assembled",
  1321 |           new_data: { sourcing_request_id: sourcingRequestId },
  1322 |         });
  1323 |       }
  1324 |       const quoteId = assembledQuoteId;
  1325 |       expect(quoteId).toMatch(/^[0-9a-f-]{36}$/i);
  1326 |       harness.track("bunya_customer_quotes", quoteId);
  1327 |       const quoteRows = await harness.serviceRows(
  1328 |         "bunya_customer_quotes",
  1329 |         `select=id,subtotal,vat_amount,delivery_fee,total,status,valid_until,expected_delivery_at&id=eq.${quoteId}`,
  1330 |       );
  1331 |       expect(quoteRows).toHaveLength(1);
  1332 |       expect(quoteRows[0].status).toBe("ready");
  1333 |       const assembledItems = await harness.serviceRows("bunya_customer_quote_items", `select=id,line_total&bunya_customer_quote_id=eq.${quoteId}`);
  1334 |       expect(assembledItems).toHaveLength(1);
  1335 |       harness.track("bunya_customer_quote_items", String(assembledItems[0].id));
  1336 |       expect(Number(assembledItems[0].line_total)).toBe(Number(quoteRows[0].total));
  1337 |       const selections = await harness.serviceRows("internal_selection_results", `select=id&sourcing_request_id=eq.${sourcingRequestId}`);
  1338 |       expect(selections).toHaveLength(1);
  1339 |       harness.track("internal_selection_results", String(selections[0].id));
  1340 |       const selectedItems = await harness.serviceRows("selected_provider_items", `select=id&selection_result_id=eq.${selections[0].id}`);
  1341 |       expect(selectedItems).toHaveLength(1);
  1342 |       harness.track("selected_provider_items", String(selectedItems[0].id));
  1343 |       return { requestId, sourcingRequestId, sourcingItemId, responseId, quoteId };
  1344 |     }
> 1345 |     expect(blockers, blockers.join("; ")).toEqual([]);
       |                                           ^ Error: contractor proposal acceptance runtime blocker on remote schema
  1346 |   } catch (error) {
  1347 |     primaryFailure = error;
  1348 |     throw error;
  1349 |   } finally {
  1350 |     const cleanupFailures = await harness.cleanupE2EFixtures();
  1351 |     await new Promise<void>((resolve) => providerMock.server.close(() => resolve()));
  1352 |     if (!primaryFailure && cleanupFailures.length) throw new Error(`Connected E2E cleanup failed: ${cleanupFailures.join("; ")}`);
  1353 |   }
  1354 | });
  1355 | 
  1356 | function observe(page: Page, consoleErrors: string[], networkErrors: string[]) {
  1357 |   page.on("console", (message) => {
  1358 |     const text = message.text();
  1359 |     const expectedDeniedRequest = text.includes("status of 403 (Forbidden)");
  1360 |     if (message.type() === "error" && !text.includes("favicon") && !expectedDeniedRequest) consoleErrors.push(text);
  1361 |   });
  1362 |   page.on("pageerror", (error) => consoleErrors.push(error.message));
  1363 |   page.on("response", (response) => {
  1364 |     if (response.status() >= 500) networkErrors.push(`${response.status()} ${new URL(response.url()).pathname}`);
  1365 |   });
  1366 |   page.on("requestfailed", (request) => {
  1367 |     const reason = request.failure()?.errorText || "unknown";
  1368 |     if (!request.url().startsWith("data:") && !reason.includes("ERR_ABORTED")) {
  1369 |       networkErrors.push(`FAILED ${new URL(request.url()).pathname} (${reason})`);
  1370 |     }
  1371 |   });
  1372 | }
  1373 | 
```