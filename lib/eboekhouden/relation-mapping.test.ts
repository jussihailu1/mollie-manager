import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  composeRelationAddress,
  localFieldsToRelationPatch,
  relationToLocalFields,
} from "@/lib/eboekhouden/relation-mapping";

describe("e-Boekhouden relation mapping", () => {
  it("composes primary address parts for local display", () => {
    assert.equal(
      composeRelationAddress({
        address: "Main Street 1",
        city: "Amsterdam",
        country: "Netherlands",
        id: 12,
        postalCode: "1000 AB",
      }),
      "Main Street 1, 1000 AB Amsterdam, Netherlands",
    );
  });

  it("maps relation fields to local customer fields", () => {
    assert.deepEqual(
      relationToLocalFields({
        address: "Main Street 1",
        city: "Amsterdam",
        contact: "Jane Doe",
        emailAddress: "jane@example.com",
        id: 12,
        name: "Acme BV",
        note: "Preferred customer",
        phoneNumber: "+31201234567",
        postalCode: "1000 AB",
      }),
      {
        address: "Main Street 1, 1000 AB Amsterdam",
        businessName: "Acme BV",
        contactName: "Jane Doe",
        email: "jane@example.com",
        notes: "Preferred customer",
        phone: "+31201234567",
      },
    );
  });

  it("builds a PATCH payload with required name and represented fields", () => {
    assert.deepEqual(
      localFieldsToRelationPatch(
        {
          address: "Local address",
          businessName: "Local BV",
          contactName: "Local Contact",
          email: "local@example.com",
          notes: "",
          phone: "+31612345678",
        },
        {
          id: 12,
          name: "Remote BV",
        },
      ),
      {
        address: "Local address",
        contact: "Local Contact",
        emailAddress: "local@example.com",
        name: "Local BV",
        phoneNumber: "+31612345678",
      },
    );
  });
});
