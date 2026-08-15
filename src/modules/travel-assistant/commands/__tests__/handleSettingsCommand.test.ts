import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { isSettingsCommand, handleSettingsCommand, tryResolvePendingAccountSelection } from "../handleSettingsCommand";
import { connectorServiceClient } from "../../../../lib/connectorServiceClient";
import { ChatMemoryRepository } from "../../storage/ChatMemoryRepository";
import { UserAirlineAccountPreferenceRepository } from "../../storage/UserAirlineAccountPreferenceRepository";

jest.mock("../../../../lib/connectorServiceClient");
jest.mock("../../storage/ChatMemoryRepository");
jest.mock("../../storage/UserAirlineAccountPreferenceRepository");

const mockClient = connectorServiceClient as jest.Mocked<typeof connectorServiceClient>;
const mockChatMemory = ChatMemoryRepository as jest.Mocked<typeof ChatMemoryRepository>;
const mockPreference = UserAirlineAccountPreferenceRepository as jest.Mocked<typeof UserAirlineAccountPreferenceRepository>;

describe("isSettingsCommand", () => {
  it("matches /settings case-insensitively", () => {
    expect(isSettingsCommand("/settings")).toBe(true);
    expect(isSettingsCommand("/SETTINGS enugu")).toBe(true);
  });

  it("does not match unrelated text", () => {
    expect(isSettingsCommand("check my settings")).toBe(false);
  });
});

describe("handleSettingsCommand", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPreference.get.mockResolvedValue(null);
  });

  it("tells the user an airline with one account is used automatically", async () => {
    mockClient.listAccounts.mockResolvedValue({ ok: true, status: 200, body: { labels: ["admin"] } } as any);
    const reply = await handleSettingsCommand("session-1", "whatsapp:1", "/settings enugu");
    expect(reply).toContain("only has one login configured");
    expect(mockChatMemory.updatePendingAction).toHaveBeenCalledWith("session-1", null);
  });

  it("lists numbered accounts and stores pending selection when an airline has multiple", async () => {
    mockClient.listAccounts.mockResolvedValue({ ok: true, status: 200, body: { labels: ["acct1", "acct2"] } } as any);
    const reply = await handleSettingsCommand("session-1", "whatsapp:1", "/settings enugu");
    expect(reply).toContain("1. acct1");
    expect(reply).toContain("2. acct2");
    expect(mockChatMemory.updatePendingAction).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({ type: "ACCOUNT_SELECTION", airline: "ENUGU", labels: ["acct1", "acct2"] })
    );
  });

  it("rejects an unrecognized airline", async () => {
    const reply = await handleSettingsCommand("session-1", "whatsapp:1", "/settings notanairline");
    expect(reply).toContain("don't recognize");
  });

  it("reports an honest error when connector-service is unreachable", async () => {
    mockClient.listAccounts.mockRejectedValue(new Error("network error"));
    const reply = await handleSettingsCommand("session-1", "whatsapp:1", "/settings enugu");
    expect(reply).toContain("couldn't reach the booking service");
  });
});

describe("tryResolvePendingAccountSelection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const pending = { type: "ACCOUNT_SELECTION" as const, airline: "ENUGU" as const, labels: ["acct1", "acct2"] };

  it("returns null when there's no pending selection", async () => {
    const result = await tryResolvePendingAccountSelection("session-1", "whatsapp:1", null, "1");
    expect(result).toBeNull();
  });

  it("resolves a numeric reply to the matching account", async () => {
    const result = await tryResolvePendingAccountSelection("session-1", "whatsapp:1", pending, "2");
    expect(result).toContain("acct2");
    expect(mockPreference.set).toHaveBeenCalledWith("whatsapp:1", "ENUGU", "acct2");
    expect(mockChatMemory.updatePendingAction).toHaveBeenCalledWith("session-1", null);
  });

  it("resolves a label reply case-insensitively", async () => {
    const result = await tryResolvePendingAccountSelection("session-1", "whatsapp:1", pending, "ACCT1");
    expect(result).toContain("acct1");
    expect(mockPreference.set).toHaveBeenCalledWith("whatsapp:1", "ENUGU", "acct1");
  });

  it("returns null (falls through) when the reply matches nothing", async () => {
    const result = await tryResolvePendingAccountSelection("session-1", "whatsapp:1", pending, "banana");
    expect(result).toBeNull();
    expect(mockPreference.set).not.toHaveBeenCalled();
  });

  it("returns null for an out-of-range number", async () => {
    const result = await tryResolvePendingAccountSelection("session-1", "whatsapp:1", pending, "99");
    expect(result).toBeNull();
  });
});
