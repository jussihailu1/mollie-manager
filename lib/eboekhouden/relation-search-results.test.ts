import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toRelationSearchResultItems } from "@/lib/eboekhouden/relation-search-results";

describe("e-Boekhouden relation search result mapping", () => {
  it("maps list rows without requiring detail hydration", () => {
    assert.deepEqual(
      toRelationSearchResultItems(
        [
          {
            code: "C001",
            contact: "Jane Doe",
            emailAddress: "jane@example.test",
            id: 1,
            name: "Acme BV",
            type: "B",
          },
        ],
        new Set(),
      ),
      [
        {
          code: "C001",
          id: 1,
          localFields: {
            address: "",
            businessName: "Acme BV",
            contactName: "Jane Doe",
            email: "jane@example.test",
            notes: "",
            phone: "",
          },
          name: "Acme BV",
          type: "B",
        },
      ],
    );
  });

  it("filters already linked relations and keeps sparse rows usable", () => {
    assert.deepEqual(
      toRelationSearchResultItems(
        [
          {
            code: "C001",
            id: 1,
            type: "B",
          },
          {
            code: "C002",
            id: 2,
          },
        ],
        new Set([1]),
      ),
      [
        {
          code: "C002",
          id: 2,
          localFields: null,
          name: "",
          type: "B",
        },
      ],
    );
  });
});
