import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  shouldPatchEboekhoudenRelation,
  toCustomerRelationFields,
} from "@/lib/onboarding/customer-relation-fields";

describe("customer relation field helpers", () => {
  it("maps optional customer form fields to local relation fields", () => {
    assert.deepEqual(
      toCustomerRelationFields({
        businessName: "Acme BV",
        contactName: "Ada Lovelace",
        email: "ada@example.test",
      }),
      {
        address: "",
        businessName: "Acme BV",
        contactName: "Ada Lovelace",
        email: "ada@example.test",
        notes: "",
        phone: "",
      },
    );
  });

  it("patches only when non-empty incoming fields differ", () => {
    const relation = {
      address: "Street 1",
      contact: "Ada Lovelace",
      emailAddress: "ada@example.test",
      id: 123,
      name: "Acme BV",
      note: "Existing note",
      phoneNumber: "123",
    };

    assert.equal(
      shouldPatchEboekhoudenRelation(
        relation,
        toCustomerRelationFields({
          address: "Street 1",
          businessName: "Acme BV",
          contactName: "Ada Lovelace",
          email: "ada@example.test",
          notes: "Existing note",
          phone: "123",
        }),
      ),
      false,
    );
    assert.equal(
      shouldPatchEboekhoudenRelation(
        relation,
        toCustomerRelationFields({
          address: "Street 1",
          businessName: "Acme BV",
          contactName: "Ada Lovelace",
          email: "new@example.test",
        }),
      ),
      true,
    );
  });
});
