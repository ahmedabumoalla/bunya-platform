// Run after `npx next typegen` or `next build`: exercise the actual Next route registry.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const generated=readFileSync('.next/types/routes.d.ts','utf8');
const appRoutes=generated.match(/type AppRoutes = ([^\n]+)/)?.[1];
assert.ok(appRoutes,'Generate Next route types before this check');
assert.ok(appRoutes.split(' | ').includes('"/merchant/products/[id]/change-request"'), 'Product correction URL must be registered with Next, not only the portal dispatcher');
const validator=readFileSync('.next/types/validator.ts','utf8');
assert.ok(validator.includes('src/app/merchant/products/[id]/change-request/page.js'), 'Next must validate the correction page handler');
console.log('PASS Next recognizes the product correction URL and its page handler');
